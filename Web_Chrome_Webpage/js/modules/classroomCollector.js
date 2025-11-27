/* global chrome */

function sanitize(input) {
  return (input || '').toString().replace(/\s+/g, ' ').trim();
}

function slugify(input) {
  return sanitize(input || 'Google Classroom')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'google-classroom';
}

function isAttachmentLink(href) {
  if (!href) return false;
  return /drive\.google\.com|docs\.google\.com|\.pdf|\.docx?|\.pptx?|\.xlsx?|\.xls|\.png|\.jpe?g|\.zip|\.txt|\.csv|\.mp4/i.test(href);
}

function basenameFromUrl(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop()) || '';
  } catch (error) {
    return (url || '').split('/').pop().split('?')[0] || '';
  }
}

function findHeadingForElement(el) {
  if (!el) return null;

  let node = el;
  for (let depth = 0; depth < 8 && node; depth++, node = node.parentElement) {
    const heading = node.querySelector?.('[role="heading"], h1, h2, h3, .QXc, .YVvGBb');
    if (heading && heading.innerText && heading.innerText.trim()) {
      return sanitize(heading.innerText);
    }
  }

  node = el;
  for (let depth = 0; depth < 8 && node; depth++, node = node.parentElement) {
    const txt = (node.innerText || node.textContent || '').trim();
    if (txt && txt.length > 5 && txt.length < 200) {
      return sanitize(txt.split('\n')[0]);
    }
  }

  return null;
}

function getClassTitle() {
  const rawTitle = (document.title || '').replace(/\s[-|].*/, '').trim();
  return sanitize(rawTitle) || 'Google Classroom';
}

function findMainContainer() {
  return document.querySelector('div[role="main"]') || document.querySelector('#yDmH0d') || document.body;
}

function findPostContainer(element) {
  if (!element) return null;
  const container = element.closest?.('[data-stream-item-id], [data-item-id], article, .YVvGBb, .SJiXId, .J1raN, .gJXKM');
  return isValidPostContainer(container) ? container : null;
}

function isValidPostContainer(container) {
  if (!container) return false;
  if (container.matches('[data-stream-item-id], [data-item-id], article, .YVvGBb, .SJiXId, .J1raN, .gJXKM')) {
    return true;
  }
  if (container.querySelector('time[datetime], [class*="NEMF4c"], [class*="LV4Jsb"]')) {
    return true;
  }
  return false;
}

function extractPostDate(container) {
  if (!container) return null;
  const timeEl = container.querySelector('time[datetime]');
  if (timeEl?.getAttribute) {
    return timeEl.getAttribute('datetime') || sanitize(timeEl.textContent);
  }
  const dateCandidate = container.querySelector('[class*="NEMF4c"], [class*="LV4Jsb"], [class*="VfPpkd-StrnGf-rymPhb-ibnC6b"]');
  if (dateCandidate && dateCandidate.textContent) {
    return sanitize(dateCandidate.textContent);
  }
  const dateText = Array.from(container.querySelectorAll('span, div'))
    .map(node => sanitize(node.textContent))
    .find(text => /\b(jan|feb|mar|apr|mei|may|jun|jul|aug|sep|oct|nov|dec|\d{1,2}\s*\w+)/i.test(text));
  return dateText || null;
}

function extractPostTitle(anchor, container) {
  if (container) {
    const titleNode = container.querySelector('[role="heading"], h1, h2, h3, .YVvGBb, .oBSRLe, .SJiXId, .z3vRcc');
    if (titleNode?.textContent?.trim()) {
      return sanitize(titleNode.textContent);
    }
  }
  const anchorText = sanitize(anchor?.innerText || anchor?.textContent);
  if (anchorText) return anchorText;
  return findHeadingForElement(anchor) || document.title || 'Untitled Post';
}

function buildPostsMap() {
  const mainEl = findMainContainer();
  const anchors = Array.from(mainEl.querySelectorAll('a[href]'));
  const attachCandidates = anchors.filter(a => isAttachmentLink(a.href));
  const posts = new Map();

  attachCandidates.forEach(anchor => {
    const container = findPostContainer(anchor);
    if (!container) {
      return;
    }
    const title = extractPostTitle(anchor, container);
    const filename = sanitize(anchor.innerText) || sanitize(basenameFromUrl(anchor.href)) || basenameFromUrl(anchor.href) || '';
    const url = anchor.href || '';
    const postDate = extractPostDate(container);

    if (!posts.has(title)) {
      posts.set(title, { attachments: [], urls: new Set(), date: postDate || null });
    }
    const entry = posts.get(title);

    if (!entry.urls.has(url)) {
      entry.attachments.push({ name: filename || basenameFromUrl(url) || '(no attachment)', url });
      entry.urls.add(url);
    }

    if (!entry.date && postDate) {
      entry.date = postDate;
    }
  });

  const headingNodes = Array.from(mainEl.querySelectorAll('[role="heading"], h1, h2, h3, .QXc, .YVvGBb'));
  headingNodes.forEach(heading => {
    const title = sanitize(heading.innerText || heading.textContent);
    if (!title) return;
    const container = findPostContainer(heading);
    if (!container) return;
    if (!posts.has(title)) {
      posts.set(title, { attachments: [], urls: new Set(), date: extractPostDate(container) });
    }
  });

  return posts;
}

function buildTsv(posts) {
  const header = ['class', 'post_title', 'post_date', 'attachment_name', 'attachment_url'].join('\t');
  const rows = [];
  const classTitle = getClassTitle();
  for (const [title, data] of posts.entries()) {
    const safeTitle = title.replace(/\t/g, ' ');
    const safeDate = (data.date || '').replace(/\t/g, ' ');
    if (!data.attachments.length) {
      rows.push([classTitle, safeTitle, safeDate, '(no attachment)', '']);
      continue;
    }
    data.attachments.forEach(({ name, url }) => {
      rows.push([
        classTitle,
        safeTitle,
        safeDate,
        (name || '(no attachment)').replace(/\t/g, ' '),
        url || ''
      ]);
    });
  }

  return {
    tsv: [header, ...rows.map(row => row.join('\t'))].join('\n'),
    metadata: {
      classTitle,
      postCount: posts.size,
      generatedAt: new Date().toISOString()
    }
  };
}

function triggerCsvDownload(content, metadata) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const classSlug = slugify(metadata?.classTitle);
  const filename = metadata?.filename || `${classSlug}-classroom_posts.csv`;
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function copyToClipboard(tsv) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(tsv);
      return true;
    } catch (error) {
      // fallback below
    }
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = tsv;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  } catch (error) {
    return false;
  }
}

function sendCsvToBackground(tsv, metadata) {
  return new Promise(resolve => {
    if (!chrome?.runtime?.id) {
      resolve(null);
      return;
    }

    try {
      chrome.runtime.sendMessage({ type: 'STORE_CLASSROOM_TSV', payload: { tsv, metadata } }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, message: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || null);
      });
    } catch (error) {
      resolve({ ok: false, message: error?.message || String(error) });
    }
  });
}

async function runExtraction() {
  const posts = buildPostsMap();
  if (!posts.size) {
    return { ok: false, message: 'No posts detected on this Classroom page.' };
  }

  const { tsv, metadata } = buildTsv(posts);
  triggerCsvDownload(tsv, metadata);
  const clipboardOk = await copyToClipboard(tsv);
  const backgroundResponse = await sendCsvToBackground(tsv, metadata);

  return {
    ok: true,
    clipboardOk,
    metadata,
    backgroundResponse
  };
}

function idOrNull(input) {
  if (!input) return null;
  try {
    const url = new URL(input);
    const driveMatch = url.pathname.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (driveMatch) return driveMatch[1];
    return url.searchParams.get('id');
  } catch (error) {
    return null;
  }
}

function mkDirect(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url, document.location.href);
    const id = idOrNull(parsed.href);
    if (!id) {
      return parsed.href;
    }
    if (parsed.hostname.includes('docs.google.com')) {
      if (parsed.pathname.includes('/document/')) {
        return `https://docs.google.com/document/d/${id}/export?format=docx`;
      }
      if (parsed.pathname.includes('/spreadsheets/')) {
        return `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`;
      }
      if (parsed.pathname.includes('/presentation/')) {
        return `https://docs.google.com/presentation/d/${id}/export/pptx`;
      }
    }
    return `https://drive.google.com/uc?export=download&id=${id}`;
  } catch (error) {
    return url;
  }
}

function sanitizeFilename(input) {
  return (input || 'attachment')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 120) || 'attachment';
}

function guessPostTitle(element) {
  if (!element) return 'unknown-post';
  const container = element.closest('[data-stream-item-id], [data-item-id], article, .YVvGBb, .SJiXId, .J1raN');
  const titleNode = container?.querySelector?.('[role="heading"], h1, h2, h3, .YVvGBb, .oBSRLe, .SJiXId, .z3vRcc');
  if (titleNode?.textContent) {
    return sanitize(titleNode.textContent);
  }
  return 'unknown-post';
}

function collectTargets() {
  const nodes = new Set();
  document.querySelectorAll('a[href], [data-download-url], [data-url]').forEach(node => nodes.add(node));

  const rows = [];
  const seen = new Set();
  nodes.forEach(node => {
    const href = node.getAttribute?.('href') || node.dataset?.downloadUrl || node.dataset?.url || '';
    if (!href) return;
    if (!/docs\.google\.com|drive\.google\.com/i.test(href)) return;
    if (seen.has(href)) return;
    seen.add(href);
    rows.push({
      element: node,
      href,
      direct: mkDirect(href),
      title: guessPostTitle(node)
    });
  });
  return rows;
}

async function filenameFromResponse(response, fallback = 'attachment') {
  const dispo = response.headers.get('content-disposition');
  if (dispo) {
    const utf8Match = dispo.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match) {
      return sanitizeFilename(decodeURIComponent(utf8Match[1]));
    }
    const quotedMatch = dispo.match(/filename="([^"]+)"/i);
    if (quotedMatch) {
      return sanitizeFilename(quotedMatch[1]);
    }
  }
  try {
    const url = new URL(response.url);
    const segment = url.pathname.split('/').pop();
    if (segment) {
      return sanitizeFilename(segment);
    }
  } catch (error) {
    // ignore
  }
  return sanitizeFilename(fallback);
}

function buildCsvFromTargets(rows, classTitle) {
  const header = ['class', 'post_title', 'attachment_name', 'original_url', 'direct_url'];
  const csvRows = [header];
  rows.forEach((row, idx) => {
    csvRows.push([
      classTitle,
      row.title || `post_${idx + 1}`,
      row.filename || `attachment_${idx + 1}`,
      row.href,
      row.direct
    ]);
  });
  const csv = csvRows.map(r => r.map(cell => JSON.stringify(cell || '')).join(',')).join('\n');
  return csv;
}

async function runBatchDownload() {
  const targets = collectTargets();
  if (!targets.length) {
    return { ok: false, message: 'No Google Drive links were detected on this page.' };
  }

  const classTitle = getClassTitle();
  targets.forEach((t, idx) => {
    t.filename = sanitizeFilename(`${t.title || 'post'}-${idx + 1}`);
  });

  const csv = buildCsvFromTargets(targets, classTitle);
  const csvFilename = `${slugify(classTitle)}-attachments.csv`;
  triggerCsvDownload(csv, { classTitle, generatedAt: new Date().toISOString(), filename: csvFilename });

  let successCount = 0;
  let failCount = 0;

  for (const target of targets) {
    try {
      const directUrl = target.direct || target.href;
      const response = await fetch(directUrl, { credentials: 'include', redirect: 'follow' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const filename = await filenameFromResponse(response, target.filename);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      successCount++;
    } catch (error) {
      console.warn('Batch download failed for', target.href, error);
      failCount++;
    }
    await new Promise(resolve => setTimeout(resolve, 700));
  }

  alert(`Batch download complete: ${successCount} success, ${failCount} failed.`);

  return {
    ok: true,
    total: targets.length,
    successCount,
    failCount,
    csvFilename
  };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.action === 'extractClassroomPosts') {
    runExtraction()
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ ok: false, message: error?.message || String(error) }));
    return true;
  }

  if (msg && msg.action === 'batchDownloadAttachments') {
    runBatchDownload()
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ ok: false, message: error?.message || String(error) }));
    return true;
  }
  return false;
});
