const { getSettings } = require('./appSettings');

// What counts towards totals and value.
//
// A sold item is no longer ours, so it never counts. Whether items marked
// lost, stolen or retired count is the organisation's choice (Settings):
// some want the register's totals to show everything ever bought, others
// only what is still held.
//
// Value is the price paid per item times how many there are, so a line of
// 40 chairs at £25 is worth £1,000 here as it is on Stock by Campus.
const WRITTEN_OFF = ['lost', 'stolen', 'retired'];
function counting() {
    const includeWrittenOff = getSettings().count_written_off;
    const excluded = ['sold', ...(includeWrittenOff ? [] : WRITTEN_OFF)];
    const list = excluded.map((status) => `'${status}'`).join(',');
    return {
        includeWrittenOff,
        excluded,
        quantity: (a = '') => `CASE WHEN ${a}status IN (${list}) THEN 0 ELSE COALESCE(${a}quantity, 0) END`,
        value: (a = '') => `CASE WHEN ${a}status IN (${list}) THEN 0 ELSE COALESCE(${a}purchase_price, 0) * COALESCE(${a}quantity, 1) END`
    };
}

module.exports = { counting, WRITTEN_OFF };
