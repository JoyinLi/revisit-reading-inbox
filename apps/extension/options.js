const defaults = { apiBase: 'http://localhost:8787', appBase: 'http://localhost:5173' };
chrome.storage.sync.get(defaults, (settings) => {
  document.getElementById('apiBase').value = settings.apiBase;
  document.getElementById('appBase').value = settings.appBase;
});
document.getElementById('save').addEventListener('click', () => {
  chrome.storage.sync.set({
    apiBase: document.getElementById('apiBase').value.replace(/\/$/, ''),
    appBase: document.getElementById('appBase').value.replace(/\/$/, '')
  }, () => {
    document.getElementById('message').textContent = 'Saved.';
  });
});
