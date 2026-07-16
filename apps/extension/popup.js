let pageData = null;
let titleTouched = false;
let captureMode = 'article';
let modeTouched = false;

const detectedTitleEl = document.getElementById('detected-title');
const customTitleEl = document.getElementById('custom-title');
const nameLabelEl = document.getElementById('name-label');
const urlEl = document.getElementById('url');
const hostEl = document.getElementById('host');
const extractionStatusEl = document.getElementById('extraction-status');
const modeHelpEl = document.getElementById('mode-help');
const modeButtons = Array.from(document.querySelectorAll('[data-mode]'));
const saveButton = document.getElementById('save');
const messageEl = document.getElementById('message');

customTitleEl.addEventListener('input', () => { titleTouched = true; });

function applyCaptureMode(nextMode, userInitiated = false) {
  captureMode = nextMode === 'website' ? 'website' : 'article';
  if (userInitiated) modeTouched = true;
  modeButtons.forEach((button) => {
    const selected = button.dataset.mode === captureMode;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-checked', String(selected));
  });
  nameLabelEl.textContent = captureMode === 'website' ? 'Website name' : 'Article name';
  saveButton.textContent = captureMode === 'website' ? 'Save website' : 'Save article';
  modeHelpEl.textContent = captureMode === 'website'
    ? 'Saves the current viewport as a compressed visual preview. No article text is extracted.'
    : 'Saves readable text and inline images for highlights and notes.';
  renderExtractionStatus();
}

modeButtons.forEach((button) => button.addEventListener('click', () => applyCaptureMode(button.dataset.mode, true)));

function renderExtractionStatus() {
  if (!pageData) return;
  if (captureMode === 'website') {
    const confidence = pageData.captureModeConfidence ? ` · ${pageData.captureModeConfidence} confidence` : '';
    extractionStatusEl.textContent = `Website preview${confidence}`;
    extractionStatusEl.className = 'extraction-status success';
    return;
  }

  const count = Array.isArray(pageData.blocks) ? pageData.blocks.length : 0;
  const imageCount = Number(pageData.extractedImageCount || 0);
  const characters = Number(pageData.extractedCharacterCount || 0);
  if (pageData.source === 'X' && pageData.resourceKind) {
    const resourceLabels = { website: 'Website share', video: 'Video post', image: 'Image post', text: 'Text post' };
    const detail = pageData.resourceKind === 'website' && pageData.sharedDomain ? ` · ${pageData.sharedDomain}` : imageCount ? ` · ${imageCount} image${imageCount === 1 ? '' : 's'}` : '';
    extractionStatusEl.textContent = `${resourceLabels[pageData.resourceKind] || 'X post'} detected${detail}`;
    extractionStatusEl.className = 'extraction-status success';
  } else if (count > 0 && characters >= 80) {
    const imageLabel = imageCount > 0 ? ` · ${imageCount} image${imageCount === 1 ? '' : 's'}` : '';
    extractionStatusEl.textContent = `Readable body detected · ${count} sections${imageLabel}`;
    extractionStatusEl.className = 'extraction-status success';
  } else {
    extractionStatusEl.textContent = 'Link only · no readable body detected';
    extractionStatusEl.className = 'extraction-status warning';
  }
}

chrome.runtime.sendMessage({ type: 'extract-active-tab' }, (response) => {
  if (!response?.ok) {
    detectedTitleEl.textContent = 'This page cannot be read';
    hostEl.textContent = response?.error || 'Try saving the link manually.';
    extractionStatusEl.textContent = 'No page access';
    extractionStatusEl.className = 'extraction-status warning';
    saveButton.disabled = true;
    return;
  }
  pageData = response.data;
  const detectedTitle = pageData.title || pageData.url;
  detectedTitleEl.textContent = detectedTitle;
  customTitleEl.value = detectedTitle;
  urlEl.textContent = pageData.url;
  try { hostEl.textContent = new URL(pageData.url).hostname; } catch { hostEl.textContent = 'Current page'; }
  if (!modeTouched) applyCaptureMode(pageData.suggestedCaptureMode || 'article');
  else renderExtractionStatus();
});

saveButton.addEventListener('click', () => {
  if (!pageData) return;
  saveButton.disabled = true;
  saveButton.textContent = captureMode === 'website' ? 'Capturing…' : 'Saving…';
  messageEl.textContent = '';
  chrome.runtime.sendMessage({
    type: 'capture',
    payload: {
      ...pageData,
      captureMode,
      title: customTitleEl.value.trim() || pageData.title || pageData.url,
      titleIsCustom: titleTouched,
      note: document.getElementById('note').value.trim(),
      status: document.getElementById('status').value
    }
  }, (response) => {
    saveButton.disabled = false;
    saveButton.textContent = captureMode === 'website' ? 'Save website' : 'Save article';
    if (response?.ok) {
      messageEl.className = 'success';
      if (captureMode === 'website' && !response.result?.item?.website_screenshot_url) {
        messageEl.textContent = 'Website saved. Screenshot was unavailable.';
      } else if (response.result?.enriched) {
        messageEl.textContent = captureMode === 'website' ? 'Website preview saved.' : 'Existing item updated with readable content.';
      } else if (response.result?.duplicate) {
        messageEl.textContent = 'Already in your Library.';
      } else {
        messageEl.textContent = 'Saved to your Library.';
      }
    } else {
      messageEl.className = 'error';
      messageEl.textContent = response?.error || 'Could not connect to the local app.';
    }
  });
});

document.getElementById('open').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'open-library' }));
