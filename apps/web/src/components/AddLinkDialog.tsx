import { FormEvent, useEffect, useRef, useState } from 'react';
import { FileText, Globe2, LoaderCircle, X } from 'lucide-react';
import { api } from '../api';

type CaptureMode = 'article' | 'website';

type Detection = {
  recommendedMode: CaptureMode;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  title?: string;
  domain: string;
};

export function AddLinkDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (id: string) => void }) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [mode, setMode] = useState<CaptureMode>('article');
  const [modeTouched, setModeTouched] = useState(false);
  const [titleTouched, setTitleTouched] = useState(false);
  const [detection, setDetection] = useState<Detection | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const detectionRequest = useRef(0);

  useEffect(() => {
    if (!open) {
      setUrl('');
      setTitle('');
      setNote('');
      setMode('article');
      setModeTouched(false);
      setTitleTouched(false);
      setDetection(null);
      setDetecting(false);
      setError('');
    }
  }, [open]);

  useEffect(() => {
    if (!open || !url.trim()) {
      setDetection(null);
      setDetecting(false);
      return;
    }
    let normalized: string;
    try {
      normalized = new URL(url.trim()).href;
    } catch {
      setDetection(null);
      setDetecting(false);
      return;
    }

    const requestId = ++detectionRequest.current;
    const timer = window.setTimeout(async () => {
      setDetecting(true);
      try {
        const result = await api.detectLink(normalized);
        if (requestId !== detectionRequest.current) return;
        setDetection(result);
        if (!modeTouched) setMode(result.recommendedMode);
        if (!titleTouched && result.title) setTitle(result.title);
      } catch {
        if (requestId === detectionRequest.current) setDetection(null);
      } finally {
        if (requestId === detectionRequest.current) setDetecting(false);
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [open, url, modeTouched, titleTouched]);

  if (!open) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await api.capture({
        url,
        title: title.trim() || undefined,
        titleIsCustom: titleTouched && Boolean(title.trim()),
        note,
        captureMode: mode
      });
      onClose();
      onSaved(result.item.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this link.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="dialog add-link-dialog" role="dialog" aria-modal="true" aria-labelledby="add-link-title">
        <div className="dialog-heading">
          <div>
            <h2 id="add-link-title">Add to Library</h2>
            <p>Save a readable article or keep the whole website as a visual reference.</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X size={19} /></button>
        </div>
        <form onSubmit={submit} className="dialog-form">
          <label>
            Link
            <input type="url" required autoFocus placeholder="https://…" value={url} onChange={(event) => setUrl(event.target.value)} />
          </label>

          <fieldset className="capture-mode-field">
            <legend>Save as</legend>
            <div className="capture-mode-toggle" role="radiogroup" aria-label="Save as website or article">
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'website'}
                className={mode === 'website' ? 'selected' : ''}
                onClick={() => { setMode('website'); setModeTouched(true); }}
              >
                <Globe2 size={16} />
                <span><strong>Website</strong><small>Visual snapshot + link</small></span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'article'}
                className={mode === 'article' ? 'selected' : ''}
                onClick={() => { setMode('article'); setModeTouched(true); }}
              >
                <FileText size={16} />
                <span><strong>Article</strong><small>Readable text + highlights</small></span>
              </button>
            </div>
            <div className="capture-detection" aria-live="polite">
              {detecting ? <><LoaderCircle size={13} className="spin" /> Detecting page type…</> : detection ? (
                <>Detected as <strong>{detection.recommendedMode === 'website' ? 'Website' : 'Article'}</strong> · {detection.reason}</>
              ) : mode === 'website' ? 'A compressed first-screen preview will be generated locally.' : 'If extraction fails, the original link is still saved.'}
            </div>
          </fieldset>

          <label>
            {mode === 'website' ? 'Website name' : 'Article name'} <span>optional</span>
            <input
              type="text"
              maxLength={500}
              placeholder="A name you will recognize later"
              value={title}
              onChange={(event) => { setTitle(event.target.value); setTitleTouched(true); }}
            />
          </label>
          <label>
            Quick note <span>optional</span>
            <textarea rows={3} placeholder="Why do you want to return to this?" value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          {error && <p className="form-error">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="button secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="button primary" disabled={loading}>{loading ? (mode === 'website' ? 'Capturing…' : 'Saving…') : `Save ${mode}`}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
