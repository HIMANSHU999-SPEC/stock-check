const Anthropic = require('@anthropic-ai/sdk');

// Asks Claude what each asset is. Used instead of the built-in rules
// whenever an API key is configured: it copes with the abbreviations, model
// numbers and supplier wording that fixed rules cannot.
//
// Only an asset's name, model, brand and current category are sent — never
// who holds it, where it is, its serial number or its price.

const MODEL = (process.env.AI_MODEL || 'claude-opus-5-5').trim();
// Assets per request: small enough to answer well within the timeout, large
// enough that the whole register is a handful of calls.
const BATCH_SIZE = 50;
const CONCURRENCY = 2;

class AiError extends Error {
    constructor(message, status = 502) {
        super(message);
        this.status = status;
    }
}

function isConfigured() {
    if (String(process.env.AI_ENABLED || '').trim().toLowerCase() === 'false') return false;
    return Boolean((process.env.ANTHROPIC_API_KEY || '').trim() || (process.env.ANTHROPIC_AUTH_TOKEN || '').trim());
}

let client = null;
function getClient() {
    if (!isConfigured()) {
        throw new AiError('AI categorising is not set up: add ANTHROPIC_API_KEY to the server\'s .env file', 400);
    }
    if (!client) client = new Anthropic({ timeout: 120 * 1000, maxRetries: 2 });
    return client;
}

const OUTPUT_SCHEMA = {
    type: 'object',
    properties: {
        results: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    id: { type: 'integer' },
                    category: { type: 'string' },
                    brand: { type: 'string' },
                    electronic: { type: 'boolean' },
                    confident: { type: 'boolean' }
                },
                required: ['id', 'category', 'brand', 'electronic', 'confident'],
                additionalProperties: false
            }
        }
    },
    required: ['results'],
    additionalProperties: false
};

function systemPrompt(categories, rules) {
    const ruleLines = rules.length
        ? rules.map((r) => `- names containing "${r.keyword}" are ${r.category}`).join('\n')
        : '(none yet)';
    return `You are helping the IT team of a UK higher-education provider keep its asset register tidy. Each asset has a name, and sometimes a model and brand, typed by staff or copied from a supplier invoice, so they are often abbreviated, misspelt, or padded with a specification. For each one, work out what kind of thing it is and who made it. Your answers are shown to a member of the IT team as suggestions; they approve them before anything changes.

Categories the register already uses:
${categories.map((c) => `- ${c}`).join('\n')}

Use one of these, spelt exactly as listed, whenever one fits. If none fits, propose a short new category in the same style (singular, title case, such as "Projector"). Do that sparingly: a register with a few broad categories is more useful than one with many narrow ones, and the same kind of item should always land in the same category.

A catch-all such as "Other", "Other Electronics" or "Electronics" is not an answer. If you cannot tell what an item is from what you are given, return an empty string for the category so a person can decide.

Categorise the item itself, not what it goes with. "Laptop charger for HP EliteBook" is an accessory, not a laptop. "HP 250 G9 i5 8GB RAM 256GB SSD UK keyboard" is a laptop described with its specification, not memory or a keyboard.

brand: the manufacturer in its usual short spelling ("HP", not "Hewlett Packard" or "hp"). Use an empty string when the name and model do not tell you; do not guess a brand from the type of item.

electronic: true for electrical or electronic equipment and its accessories (computers, screens, phones, printers, network kit, cables, chargers, peripherals); false for furniture, stationery, consumables and anything else.

confident: true when the name makes the answer clear. false when you are inferring from thin evidence, such as a bare model number or an ambiguous word; a person will look at those more carefully.

The organisation's own rules, which take priority over your judgement:
${ruleLines}`;
}

function explain(error) {
    if (error instanceof AiError) return error;
    if (error instanceof Anthropic.AuthenticationError) {
        return new AiError('The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in the server\'s .env file.');
    }
    if (error instanceof Anthropic.PermissionDeniedError) {
        return new AiError(`The Anthropic API key is not allowed to use ${MODEL}.`);
    }
    if (error instanceof Anthropic.NotFoundError) {
        return new AiError(`The AI model "${MODEL}" was not found. Check AI_MODEL in the server's .env file.`);
    }
    if (error instanceof Anthropic.RateLimitError) {
        return new AiError('The AI service is busy or over its limit. Try again in a minute.', 503);
    }
    if (error instanceof Anthropic.BadRequestError) {
        return new AiError(`The AI service rejected the request: ${error.message}`);
    }
    if (error instanceof Anthropic.APIConnectionError) {
        return new AiError('Could not reach the AI service. Check the server\'s internet connection and try again.', 503);
    }
    if (error instanceof Anthropic.APIError) {
        return new AiError(`The AI service returned an error (${error.status || 'unknown'}). Try again shortly.`, 503);
    }
    return error;
}

// One request for up to BATCH_SIZE assets. Resolves with
// { results: [{ id, category, brand, electronic, confident }], usage }.
async function classifyChunk(items, categories, rules, options = {}) {
    let response;
    try {
        response = await getClient().beta.messages.create({
            model: MODEL,
            max_tokens: 16000,
            // If the model declines, let the API retry on its recommended
            // fallback rather than returning nothing.
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            // Short, clear-cut judgements: low effort is plenty.
            output_config: { effort: 'low', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
            system: systemPrompt(categories, rules),
            messages: [{
                role: 'user',
                content: `Categorise these ${items.length} assets. Return one result for each, with the same id.\n\n${JSON.stringify(items)}`
            }]
        }, options.timeout ? { timeout: options.timeout, maxRetries: 0 } : undefined);
    } catch (error) {
        throw explain(error);
    }

    if (response.stop_reason === 'refusal') {
        throw new AiError('The AI service declined to categorise this batch.');
    }
    if (response.stop_reason === 'max_tokens') {
        throw new AiError('The AI reply was cut short. Try again; if it keeps happening, lower the batch size.');
    }
    const text = response.content.filter((block) => block.type === 'text').map((block) => block.text).join('');
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        throw new AiError('The AI reply could not be read. Try again.');
    }

    const wanted = new Set(items.map((item) => item.id));
    const results = (Array.isArray(parsed.results) ? parsed.results : [])
        .filter((row) => wanted.has(row.id))
        .map((row) => ({
            id: row.id,
            category: String(row.category || '').trim().slice(0, 60),
            brand: String(row.brand || '').trim().slice(0, 60),
            electronic: Boolean(row.electronic),
            confident: Boolean(row.confident)
        }));
    return {
        results,
        usage: {
            input: response.usage?.input_tokens || 0,
            output: response.usage?.output_tokens || 0
        }
    };
}

/**
 * Categorise any number of assets: [{ id, name, model, brand, current_category }].
 * `onChunk(items, results, usage)` is called as each batch finishes, so a
 * caller can keep what has arrived even if a later batch fails. Resolves with
 * a Map of id -> result; an asset the model skipped is simply absent.
 */
async function classifyMany(items, categories, rules, { onChunk, timeout } = {}) {
    const chunks = [];
    for (let i = 0; i < items.length; i += BATCH_SIZE) chunks.push(items.slice(i, i + BATCH_SIZE));

    const byId = new Map();
    let next = 0;
    let failed = false;

    async function worker() {
        // Once one batch fails, the others finish what they are doing and stop,
        // so nothing is still arriving after the caller has been told it failed.
        while (next < chunks.length && !failed) {
            const chunk = chunks[next];
            next += 1;
            let reply;
            try {
                reply = await classifyChunk(chunk, categories, rules, { timeout });
            } catch (error) {
                failed = true;
                throw error;
            }
            reply.results.forEach((row) => byId.set(row.id, row));
            if (onChunk) onChunk(chunk, reply.results, reply.usage);
        }
    }

    // Wait for every worker to stop before reporting, success or not.
    const outcomes = await Promise.allSettled(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));
    const failure = outcomes.find((outcome) => outcome.status === 'rejected');
    if (failure) throw failure.reason;
    return byId;
}

module.exports = { isConfigured, classifyMany, AiError, MODEL };
