/**
 * Background Service Worker for Bookmark Kanban
 * Copyright (c) 2025 Chen Yifeng
 * 
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { siteChecker } from './modules/siteChecker.js';
import { collectGoogleClassroomData } from './modules/classroomCollectorBackground.js';

// Store check results in memory for current session
let currentSessionResults = {};

// Debug mode flag - 设置为 false 以禁用调试日志
const isDebug = false;

// Debug log helper
function _debug(...args) {
  if (isDebug) {
    console.debug(...args);
  }
}

// Initialize storage when browser starts or extension is loaded
const initSessionStorage = async () => {
  // Check if session storage is supported
  if (chrome.storage.session) {
    try {
      // Initialize session storage
      await chrome.storage.session.clear();
      currentSessionResults = {};
      _debug('Session storage initialized');
    } catch (error) {
      _debug('Failed to initialize session storage');
    }
  }
};

// Initialize on extension startup
initSessionStorage();

// Listen for installation
chrome.runtime.onInstalled.addListener(() => {
  // Initialize extension settings
  chrome.storage.sync.get(['showOnNewTab'], (result) => {
    if (result.showOnNewTab === undefined) {
      // Set default value for new installations
      chrome.storage.sync.set({ showOnNewTab: true });
    }
  });

  // scheduleNextCheck(); // Removed automatic checking
});

// Listen for messages from content scripts or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'YT_CLEAN') {
    // Perform YouTube tab clean in background where tabs API is available
    (async () => {
      try {
        if (message.mode === 'close_left') {
          const [activeTab] = await new Promise((resolve) => {
            chrome.tabs.query({ active: true, currentWindow: true }, resolve);
          });
          if (!activeTab) { sendResponse({ ok: false, error: 'No active tab' }); return; }
          const ytTabsInWindow = await new Promise((resolve) => {
            chrome.tabs.query({ windowId: activeTab.windowId, url: ['*://*.youtube.com/*', '*://youtube.com/*'] }, resolve);
          });
          const toClose = ytTabsInWindow.filter(t => typeof t.index === 'number' && t.index < activeTab.index);
          if (!toClose.length) { sendResponse({ ok: true, closed: 0 }); return; }
          chrome.tabs.remove(toClose.map(t => t.id), () => {
            void chrome.runtime?.lastError;
            sendResponse({ ok: true, closed: toClose.length });
          });
          return;
        }

        const allYouTubeTabs = await new Promise((resolve) => {
          chrome.tabs.query({ url: ['*://*.youtube.com/*', '*://youtube.com/*'] }, resolve);
        });
        if (!allYouTubeTabs || allYouTubeTabs.length <= 1) { sendResponse({ ok: true, closed: 0 }); return; }

        const playingTabs = allYouTubeTabs.filter(tab => tab.audible && !(tab.mutedInfo && tab.mutedInfo.muted));
        const pinnedTabs = allYouTubeTabs.filter(tab => tab.pinned);

        const windowIdToTabs = new Map();
        for (const tab of allYouTubeTabs) {
          const arr = windowIdToTabs.get(tab.windowId) || [];
          arr.push(tab);
          windowIdToTabs.set(tab.windowId, arr);
        }

        const mostRecentPerWindow = [];
        for (const [, tabs] of windowIdToTabs) {
          const activeTab = tabs.find(t => t.active);
          if (activeTab) { mostRecentPerWindow.push(activeTab); continue; }
          const mostRecent = [...tabs].sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
          if (mostRecent) mostRecentPerWindow.push(mostRecent);
        }

        const tabsToKeepIds = new Set([
          ...playingTabs.map(t => t.id),
          ...pinnedTabs.map(t => t.id),
          ...mostRecentPerWindow.map(t => t.id)
        ]);

        const tabsToClose = allYouTubeTabs.filter(t => !tabsToKeepIds.has(t.id));
        if (tabsToClose.length === 0) { sendResponse({ ok: true, closed: 0 }); return; }

        chrome.tabs.remove(tabsToClose.map(t => t.id), () => {
          void chrome.runtime?.lastError;
          sendResponse({ ok: true, closed: tabsToClose.length });
        });
      } catch (e) {
        sendResponse({ ok: false, error: e && e.message ? e.message : String(e) });
      }
    })();
    return true; // keep channel open for async sendResponse
  }

  if (message.type === 'GC_COLLECT') {
    (async () => {
      try {
        // Helper to open a tab and provide a minimal page-like API
        const openTab = async (url) => {
          const tab = await new Promise(resolve => chrome.tabs.create({ url, active: false }, resolve));
          // Wait briefly; MV3 has no direct Page API, so we simulate waits using timeouts and navigation checks
          const waitForTimeout = (ms) => new Promise(r => setTimeout(r, ms));
          const ensureLoaded = async () => {
            // poll the tab status a couple times
            for (let i = 0; i < 10; i++) {
              const [t] = await new Promise(r => chrome.tabs.query({ id: tab.id }, r));
              if (t && t.status === 'complete') break;
              await waitForTimeout(300);
            }
          };
          await ensureLoaded();
          return {
            waitForTimeout,
            evaluate: async (fn, arg) => {
              return await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: fn,
                args: [arg]
              }).then(res => res && res[0] ? res[0].result : null).catch(() => null);
            }
          };
        };

        const result = await collectGoogleClassroomData(openTab);
        sendResponse({ ok: true, ...result });
      } catch (e) {
        sendResponse({ ok: false, error: e && e.message ? e.message : String(e) });
      }
    })();
    return true;
  }
  if (message.type === 'STORE_CLASSROOM_TSV') {
    (async () => {
      try {
        const { tsv, metadata } = message.payload || {};
        if (!tsv) {
          sendResponse({ ok: false, message: 'Missing TSV payload' });
          return;
        }

        const classSlug = (metadata?.classTitle || 'Google Classroom')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '') || 'google-classroom';
        const timestamp = metadata?.generatedAt || new Date().toISOString();
        const tsSlug = timestamp.replace(/[:.]/g, '-');
        const filename = `csv_exported/${classSlug}-${tsSlug}.tsv`;

        const blob = new Blob([tsv], { type: 'text/tab-separated-values;charset=utf-8;' });
        const objectUrl = URL.createObjectURL(blob);

        const downloadId = await chrome.downloads.download({
          url: objectUrl,
          filename,
          saveAs: false,
          conflictAction: 'overwrite'
        });

        // Revoke after short delay to avoid invalidating download
        setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);

        sendResponse({ ok: true, filename, downloadId });
      } catch (error) {
        sendResponse({ ok: false, message: error?.message || String(error) });
      }
    })();
    return true;
  }

  if (message.type === 'GET_BOOKMARKS') {
    // Handle bookmark data requests
    chrome.bookmarks.getTree((tree) => {
      sendResponse({ bookmarks: tree });
    });
    return true; // Will respond asynchronously
  }
  
  if (message.type === 'UPDATE_BOOKMARK') {
    // Handle bookmark updates
    chrome.bookmarks.update(message.bookmarkId, message.changes, (bookmark) => {
      sendResponse({ success: true, bookmark });
    });
    return true;
  }
  
  if (message.type === 'DELETE_BOOKMARK') {
    // Handle bookmark deletion
    chrome.bookmarks.removeTree(message.bookmarkId, () => {
      sendResponse({ success: true });
    });
    return true;
  }
  
  if (message.type === 'CREATE_BOOKMARK') {
    // Handle new bookmark creation
    chrome.bookmarks.create(message.bookmark, (bookmark) => {
      sendResponse({ success: true, bookmark });
    });
    return true;
  }

  if (message.type === 'CHECK_BOOKMARKS') {
    // Manual bookmark check triggered
    _debug('Manual bookmark check triggered');
    
    // Create a helper function for safe response
    const safeResponse = (data) => {
      try {
        sendResponse(data);
      } catch (error) {
        _debug('Error sending response');
      }
    };
    
    // Start check but send initial response immediately
    safeResponse({ started: true });
    
    // Continue with the check
    checkAllBookmarks().then((result) => {
      _debug('Manual bookmark check completed successfully');
    }).catch(() => {
      _debug('Manual check failed');
    });
    
    return false; // We already responded, no need to keep channel open
  }
  
  // Return false to indicate no async response needed
  return false;
});

// Listen for bookmark changes
chrome.bookmarks.onCreated.addListener((id, bookmark) => {
  // Notify all tabs about the new bookmark
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, {
        type: 'BOOKMARK_CREATED',
        bookmark
      }).catch(() => {
        // Ignore errors for inactive tabs
      });
    });
  });
});

chrome.bookmarks.onRemoved.addListener((id, removeInfo) => {
  // Notify all tabs about the removed bookmark
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, {
        type: 'BOOKMARK_REMOVED',
        id,
        removeInfo
      }).catch(() => {
        // Ignore errors for inactive tabs
      });
    });
  });
});

chrome.bookmarks.onChanged.addListener((id, changeInfo) => {
  // Notify all tabs about the changed bookmark
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, {
        type: 'BOOKMARK_CHANGED',
        id,
        changeInfo
      }).catch(() => {
        // Ignore errors for inactive tabs
      });
    });
  });
});

// Handle extension icon click
chrome.action.onClicked.addListener((tab) => {
  // If the extension icon is clicked on a new tab page,
  // refresh the page to update the bookmark kanban
  if (tab.url.startsWith('chrome://newtab')) {
    chrome.tabs.reload(tab.id);
  }
});

// Check all bookmarks
async function checkAllBookmarks() {
  try {
    _debug('=== Starting bookmark check... ===');
    const bookmarks = await chrome.bookmarks.getTree();
    const results = new Map();
    let total = 0;
    let checked = 0;
    
    // First calculate total count
    await traverseBookmarks(bookmarks, (bookmark) => {
      if (bookmark.url) total++;
    });
    
    _debug(`Found ${total} bookmarks to check`);
    
    // Send start message and total count to all tabs
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          type: 'CHECK_STARTED',
          total: total
        }).catch(() => {
          // Ignore errors for inactive tabs
        });
      });
    });
    
    // Collect all bookmarks to check
    const bookmarksToCheck = [];
    await traverseBookmarks(bookmarks, (bookmark) => {
      if (bookmark.url) {
        try {
          const url = new URL(bookmark.url);
          bookmarksToCheck.push({ bookmark, url });
        } catch (error) {
          _debug(`Invalid URL skipped: ${bookmark.url}`);
        }
      }
    });
    
    // Process bookmarks in batches with concurrency control
    const batchSize = 30; // 增加批处理大小
    const maxConcurrent = 3; // 减少并发数，避免请求过于密集
    
    for (let i = 0; i < bookmarksToCheck.length; i += batchSize) {
      const batch = bookmarksToCheck.slice(i, i + batchSize);
      
      // 使用 Promise.allSettled 处理并发
      const batchResults = await Promise.allSettled(
        batch.map(async ({ bookmark, url }) => {
          try {
            const isAlive = await siteChecker.checkSite(url.hostname);
            results.set(bookmark.id, isAlive);
            if (isDebug) {
              const status = isAlive === true ? '✅' : 
                            isAlive === 'certificate-error' ? '⚠️' : 
                            isAlive === 'no-https' ? '🔓' : '🚫';
              _debug(`${status} ${url.hostname}`);
            }
          } catch (error) {
            results.set(bookmark.id, false);
            _debug(`Check failed: ${url.hostname}`);
          }
        })
      );
      
      // Update progress
      checked += batch.length;
      
      // Send progress update to all tabs
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, {
            type: 'CHECK_PROGRESS',
            checked: checked,
            total: total,
            current: batch[batch.length - 1].url.hostname
          }).catch(() => {
            // Ignore errors for inactive tabs
          });
        });
      });
      
      // 添加小延迟，避免请求过于密集
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    // Store results in session storage
    if (chrome.storage.session) {
      try {
        await chrome.storage.session.set({ siteStatus: Object.fromEntries(results) });
        currentSessionResults = Object.fromEntries(results);
      } catch (error) {
        _debug('Failed to store results in session storage');
      }
    }
    
    // Send completion message to all tabs
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          type: 'CHECK_COMPLETED',
          siteStatus: Object.fromEntries(results)
        }).catch(() => {
          // Ignore errors for inactive tabs
        });
      });
    });
    
    return Object.fromEntries(results);
  } catch (error) {
    _debug('Error during bookmark check:', error);
    
    // Send error message to all tabs
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          type: 'CHECK_FAILED',
          error: error.message
        }).catch(() => {
          // Ignore errors for inactive tabs
        });
      });
    });
    
    throw error;
  }
}

// Helper function to traverse bookmarks
async function traverseBookmarks(bookmarks, callback) {
  for (const bookmark of bookmarks) {
    if (bookmark.children) {
      await traverseBookmarks(bookmark.children, callback);
    } else {
      await callback(bookmark);
    }
  }
} 