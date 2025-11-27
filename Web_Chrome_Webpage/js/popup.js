// js/popup.js
/* global chrome */
import { storageManager } from './modules/storageManager.js';
import { themeManager } from './modules/themeManager.js';

class PopupManager {
  constructor() {
    this.initialize();
  }

  initialize() {
    this.loadSettings();
    this.classroomStatusEl = document.getElementById('classroom-status');
    this.classroomButtonEl = document.getElementById('btnExtractClassroom');
    this.batchDownloadButtonEl = document.getElementById('btnBatchDownload');
    this.driveTestStatusEl = document.getElementById('drive-test-status');
    this.driveTestButtonEl = document.getElementById('btnTestDriveDownload');
    this.setupEventListeners();
  }

  setupEventListeners() {
    const checkbox = document.getElementById('show-on-newtab');
    if (checkbox) {
      checkbox.addEventListener('change', (event) => {
        this.saveSettings(event.target.checked);
      });
    }

    const themeSelector = document.getElementById('theme-selector');
    if (themeSelector) {
      themeSelector.addEventListener('change', (event) => this.handleThemeChange(event.target.value));
    }

    const displayModeSelector = document.getElementById('display-mode-selector');
    if (displayModeSelector) {
      displayModeSelector.addEventListener('change', (event) => this.handleDisplayModeChange(event.target.value));
    }

    const refreshButton = document.getElementById('refresh-bookmarks');
    if (refreshButton) {
      refreshButton.addEventListener('click', () => this.handleRefresh());
    }

    const resetButton = document.getElementById('reset-layout');
    if (resetButton) {
      resetButton.addEventListener('click', () => this.handleResetLayout());
    }

    if (this.classroomButtonEl) {
      this.classroomButtonEl.addEventListener('click', () => this.handleClassroomExtract());
    }

    if (this.batchDownloadButtonEl) {
      this.batchDownloadButtonEl.addEventListener('click', () => this.handleBatchDownload());
    }

    if (this.driveTestButtonEl) {
      this.driveTestButtonEl.addEventListener('click', () => this.handleDriveTest());
    }
  }

  /**
   * Load settings
   */
  loadSettings() {
    chrome.storage.sync.get(['showOnNewTab'], result => {
      const checkbox = document.getElementById('show-on-newtab');
      checkbox.checked = result.showOnNewTab !== false;
    });
    
    const themeSelector = document.getElementById('theme-selector');
    themeSelector.value = themeManager.getCurrentTheme();
    
    document.documentElement.setAttribute('data-theme', themeManager.getCurrentTheme());

    // Load display mode settings
    this.loadDisplayModeSettings();
  }

  /**
   * Load display mode settings
   */
  loadDisplayModeSettings() {
    chrome.storage.sync.get(['bookmark_board_display_mode'], result => {
      const displayModeSelector = document.getElementById('display-mode-selector');
      if (displayModeSelector) {
        displayModeSelector.value = result.bookmark_board_display_mode || 'double';
      }
    });
  }

  /**
   * Handle theme change
   * @param {string} theme Theme name
   */
  async handleThemeChange(theme) {
    try {
      document.documentElement.setAttribute('data-theme', theme === 'default' ? '' : theme);
      
      const success = await themeManager.switchTheme(theme);
      
      if (success) {
        this.showToast('Theme updated');
        
        const tabs = await chrome.tabs.query({ url: 'chrome://newtab/*' });
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, { type: 'THEME_CHANGED', theme }).catch(() => {
            // Ignore tabs that cannot communicate
          });
        });
      } else {
        this.showToast('Failed to update theme', 'error');
      }
    } catch (error) {
      console.error('Failed to change theme:', error);
      this.showToast('Failed to update theme', 'error');
    }
  }

  /**
   * Handle display mode change
   * @param {string} mode Display mode name
   */
  async handleDisplayModeChange(mode) {
    try {
      await chrome.storage.sync.set({ 'bookmark_board_display_mode': mode });
      
      this.showToast('Display mode updated');
      
      const tabs = await chrome.tabs.query({ url: 'chrome://newtab/*' });
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { type: 'DISPLAY_MODE_CHANGED', mode }).catch(() => {
          // Ignore tabs that cannot communicate
        });
      });
    } catch (error) {
      console.error('Failed to change display mode:', error);
      this.showToast('Failed to update display mode', 'error');
    }
  }

  /**
   * Save settings
   */
  async saveSettings(showOnNewTab) {
    try {
      await chrome.storage.sync.set({ showOnNewTab });
      this.showSaveSuccess();
    } catch (error) {
      console.error('Failed to save settings:', error);
      this.showSaveError();
    }
  }

  /**
   * Handle refresh operation
   */
  async handleRefresh() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const currentTab = tabs[0];
      
      if (currentTab.url.startsWith('chrome://newtab')) {
        await chrome.tabs.reload(currentTab.id);
        window.close();
      } else {
        this.showRefreshHint();
      }
    } catch (error) {
      console.error('Failed to refresh:', error);
      this.showRefreshError();
    }
  }

  /**
   * Handle reset layout operation
   */
  async handleResetLayout() {
    try {
      // Confirmation dialog
      if (confirm('Are you sure you want to reset the board layout? This will restore the default order of columns and bookmarks.')) {
        // Clear all layout data
        storageManager.clearAllOrderData();
        
        // Refresh current tab
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const currentTab = tabs[0];
        
        if (currentTab.url.startsWith('chrome://newtab')) {
          await chrome.tabs.reload(currentTab.id);
        }
        
        this.showToast('Layout has been reset');
        
        // Close popup window
        setTimeout(() => window.close(), 1500);
      }
    } catch (error) {
      console.error('Failed to reset layout:', error);
      this.showToast('Failed to reset layout', 'error');
    }
  }

  /**
   * Show save success message
   */
  showSaveSuccess() {
    this.showToast('Settings saved');
  }

  /**
   * Show save error message
   */
  showSaveError() {
    this.showToast('Failed to save settings', 'error');
  }

  /**
   * Show refresh hint message
   */
  showRefreshHint() {
    this.showToast('Please check the new tab page for updates');
  }

  /**
   * Show refresh error message
   */
  showRefreshError() {
    this.showToast('Refresh failed, please try again', 'error');
  }

  setClassroomStatus(message, state = 'idle') {
    if (!this.classroomStatusEl) {
      return;
    }
    this.classroomStatusEl.textContent = message;
    const states = ['idle', 'running', 'success', 'error'];
    states.forEach(status => this.classroomStatusEl.classList.remove(`classroom-status--${status}`));
    this.classroomStatusEl.classList.add(`classroom-status--${state}`);
  }

  setClassroomButtonDisabled(disabled) {
    if (this.classroomButtonEl) {
      this.classroomButtonEl.disabled = disabled;
    }
    if (this.batchDownloadButtonEl) {
      this.batchDownloadButtonEl.disabled = disabled;
    }
  }

  setDriveTestStatus(message, state = 'idle') {
    if (!this.driveTestStatusEl) return;
    this.driveTestStatusEl.textContent = message;
    const states = ['idle', 'running', 'success', 'error'];
    states.forEach(status => this.driveTestStatusEl.classList.remove(`classroom-status--${status}`));
    this.driveTestStatusEl.classList.add(`classroom-status--${state}`);
  }

  setDriveTestButtonDisabled(disabled) {
    if (this.driveTestButtonEl) {
      this.driveTestButtonEl.disabled = disabled;
    }
  }

  async handleClassroomExtract() {
    try {
      this.setClassroomButtonDisabled(true);
      this.setClassroomStatus('Checking active tab…', 'running');

      const tab = await this.getActiveTab();
      if (!tab) {
        this.setClassroomStatus('No active tab found. Please open Classroom first.', 'error');
        return;
      }

      if (!this.isClassroomUrl(tab.url)) {
        this.setClassroomStatus('Active tab is not Google Classroom. Switch to Classroom and try again.', 'error');
        return;
      }

      this.setClassroomStatus('Extracting posts inside Classroom…', 'running');
      
      // Always inject script programmatically to ensure it's available
      // (content scripts from manifest only load on new page loads)
      this.setClassroomStatus('Injecting extraction script…', 'running');
      let response = await this.executeExtractionScript(tab.id);

      if (!response || !response.ok) {
        const errorMessage = response?.message || 'Extraction failed. Reload the Classroom tab and try again.';
        this.setClassroomStatus(errorMessage, 'error');
        return;
      }

      const { metadata, clipboardOk, backgroundResponse } = response;
      const parts = [];
      if (metadata?.postCount != null) {
        parts.push(`${metadata.postCount} posts captured`);
      }
      parts.push(clipboardOk ? 'copied to clipboard' : 'clipboard copy failed');
      if (backgroundResponse?.ok) {
        parts.push(`saved to ${backgroundResponse.filename}`);
      }

      this.setClassroomStatus(parts.join(' · '), 'success');
      this.showToast('Classroom CSV ready!');
    } catch (error) {
      console.error('Classroom extraction failed', error);
      this.setClassroomStatus('Unexpected error. See console for details.', 'error');
    } finally {
      this.setClassroomButtonDisabled(false);
    }
  }

  async executeExtractionScript(tabId) {
    try {
      // Inject the content script file to ensure all functions are available
      // This works even if the page was loaded before extension installation
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['js/modules/classroomCollector.js']
      });
      
      // Wait for the script to initialize and register its message listener
      // Multiple short waits with retries for reliability
      let response = null;
      let attempts = 0;
      const maxAttempts = 5;
      
      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 150));
        response = await this.sendMessageToTab(tabId, { action: 'extractClassroomPosts' });
        
        if (response && response.ok !== undefined) {
          // Got a valid response (even if ok is false, it means the listener is working)
          break;
        }
        
        attempts++;
      }
      
      if (!response || (response.ok === false && response.message?.includes('Receiving end'))) {
        return { ok: false, message: 'Content script failed to initialize. Try reloading the Classroom page.' };
      }
      
      return response;
    } catch (error) {
      console.error('Failed to inject extraction script:', error);
      return { ok: false, message: `Script injection failed: ${error.message || String(error)}` };
    }
  }

  async getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs?.[0] || null;
  }

  isClassroomUrl(url = '') {
    return /^https:\/\/classroom\.google\.com\//.test(url);
  }

  async handleBatchDownload() {
    try {
      this.setClassroomButtonDisabled(true);
      this.setClassroomStatus('Preparing batch download…', 'running');

      const tab = await this.getActiveTab();
      if (!tab) {
        this.setClassroomStatus('No active tab found. Open Classroom first.', 'error');
        return;
      }
      if (!this.isClassroomUrl(tab.url)) {
        this.setClassroomStatus('Active tab is not Google Classroom.', 'error');
        return;
      }

      this.setClassroomStatus('Collecting Drive links on page…', 'running');
      const response = await this.sendMessageToTab(tab.id, { action: 'batchDownloadAttachments' });

      if (!response || !response.ok) {
        const errorMessage = response?.message || 'Batch download failed.';
        this.setClassroomStatus(errorMessage, 'error');
        return;
      }

      const { total, successCount, failCount, csvFilename } = response;
      this.setClassroomStatus(`Batch complete: ${successCount}/${total} files, CSV: ${csvFilename}`, failCount ? 'error' : 'success');
      this.showToast('Batch download finished. Check your downloads folder.');
    } catch (error) {
      console.error('Batch download failed', error);
      this.setClassroomStatus('Unexpected error during batch download.', 'error');
    } finally {
      this.setClassroomButtonDisabled(false);
    }
  }

  getDirectDriveUrl(input) {
    if (!input) {
      return null;
    }
    try {
      const url = new URL(input);
      if (url.hostname.includes('drive.google.com')) {
        const fileIdMatch = url.pathname.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (fileIdMatch) {
          return `https://drive.google.com/uc?export=download&id=${fileIdMatch[1]}`;
        }
        const idParam = url.searchParams.get('id');
        if (idParam) {
          return `https://drive.google.com/uc?export=download&id=${idParam}`;
        }
      }
    } catch (error) {
      return null;
    }
    return null;
  }

  async handleDriveTest() {
    try {
      this.setDriveTestButtonDisabled(true);
      this.setDriveTestStatus('Waiting for Drive link input…', 'running');
      const sample = 'https://drive.google.com/file/d/1r0pN96CB2TFBgqsSVqSdz8CA0nVddOcx/view?usp=sharing';
      const link = prompt('Enter a public Google Drive link to test.', sample);
      if (!link) {
        this.setDriveTestStatus('Test canceled.', 'idle');
        return;
      }
      const directUrl = this.getDirectDriveUrl(link.trim());
      if (!directUrl) {
        this.setDriveTestStatus('Unable to parse Drive file ID. Please provide a /file/d/... link.', 'error');
        return;
      }

      this.setDriveTestStatus('Requesting download from Drive…', 'running');
      const filename = `csv_exported/drive-test-${Date.now()}.bin`;
      const downloadId = await chrome.downloads.download({
        url: directUrl,
        filename,
        saveAs: false,
        conflictAction: 'overwrite'
      });

      if (typeof downloadId === 'number') {
        this.setDriveTestStatus(`Success! Saved to ${filename}`, 'success');
        this.showToast('Drive direct download succeeded.');
      } else {
        this.setDriveTestStatus('Chrome did not return a download ID.', 'error');
      }
    } catch (error) {
      const message = error?.message || String(error);
      this.setDriveTestStatus(`Download failed: ${message}`, 'error');
    } finally {
      this.setDriveTestButtonDisabled(false);
    }
  }

  sendMessageToTab(tabId, payload) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, payload, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, message: chrome.runtime.lastError.message });
          return;
        }
        resolve(response);
      });
    });
  }

  /**
   * Show toast message
   */
  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    
    document.body.appendChild(toast);
    
    // Auto dismiss
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  /**
   * Show about dialog
   */
  showAboutDialog() {
    const manifest = chrome.runtime.getManifest();
    alert(`Bookmark Kanban v${manifest.version}\n\nA simple bookmark management tool`);
  }
}

// Initialize popup manager
document.addEventListener('DOMContentLoaded', () => {
  new PopupManager();
});