import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

// Camera-based QR/barcode scanner. Renders a live camera view; each successful
// decode is passed to onScan(text). Works in the browser over HTTPS (camera
// access requires a secure context). Keeps scanning so multiple books can be
// scanned in a row; a short debounce prevents the same code firing repeatedly.
const VIEW_ID = 'camera-scanner-view';

export default function CameraScanner({ onScan, onClose }) {
    const [error, setError] = useState('');
    const [ready, setReady] = useState(false);
    const scannerRef = useRef(null);
    const lastScan = useRef({ text: '', at: 0 });

    useEffect(() => {
        let cancelled = false;
        const html5 = new Html5Qrcode(VIEW_ID, { verbose: false });
        scannerRef.current = html5;

        html5
            .start(
                { facingMode: 'environment' },
                { fps: 10, qrbox: { width: 250, height: 250 } },
                (decodedText) => {
                    const now = Date.now();
                    if (decodedText === lastScan.current.text && now - lastScan.current.at < 2500) {
                        return;
                    }
                    lastScan.current = { text: decodedText, at: now };
                    onScan(decodedText);
                },
                () => {}
            )
            .then(() => {
                if (!cancelled) setReady(true);
            })
            .catch((err) => {
                if (!cancelled) {
                    setError(
                        (err && err.message) ||
                        'Unable to start the camera. Allow camera access and make sure the site is opened over HTTPS.'
                    );
                }
            });

        return () => {
            cancelled = true;
            const inst = scannerRef.current;
            if (inst) {
                inst
                    .stop()
                    .then(() => inst.clear())
                    .catch(() => {});
            }
        };
    }, []);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '420px' }}>
                <div className="flex justify-between items-center mb-2">
                    <h3>Scan a book</h3>
                    <button className="btn btn-sm btn-secondary" onClick={onClose}>Close</button>
                </div>

                <div
                    id={VIEW_ID}
                    style={{ width: '100%', minHeight: '260px', background: '#000', borderRadius: '8px', overflow: 'hidden' }}
                />

                {!ready && !error && (
                    <p className="text-muted mt-2">Starting camera… allow access if prompted.</p>
                )}
                {error && (
                    <p className="mt-2" style={{ color: 'var(--danger, #ef4444)' }}>{error}</p>
                )}
                <p className="text-muted mt-2" style={{ fontSize: '0.85rem' }}>
                    Point the camera at a book's printed QR tag. Each scan adds it to the issue list.
                </p>
            </div>
        </div>
    );
}
