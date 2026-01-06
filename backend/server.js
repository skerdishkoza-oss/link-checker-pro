// backend/server.js - COMPLETE FIXED VERSION
// Install dependencies: npm install express cors puppeteer axios

const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const axios = require('axios');
const { URL } = require('url');

const app = express();
const corsOptions = {
  origin: process.env.NODE_ENV === 'production'
    ? process.env.FRONTEND_URL || '*'  // Allow Replit frontend
    : '*',  // Allow all in development
  credentials: true
};
app.use(cors(corsOptions));
app.use(express.json());

const PORT = process.env.PORT || 3000;  // Replit expects port 3000
const HOST = '0.0.0.0';  // Listen on all interfaces

// In-memory cache for Claude API responses
const analysisCache = new Map();

// Utility: Check if URL is valid
function isValidUrl(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

// Check if URL is an affiliate/tracking link
function isAffiliateLink(url) {
  const affiliatePatterns = [
    '/api/click',
    '/track',
    '/aff',
    '/redirect',
    '/redir',
    '/goto',
    '/out',
    'clickid',
    'affid',
    'tid='
  ];
  return affiliatePatterns.some(pattern => url.toLowerCase().includes(pattern));
}

// Check if URL is a tracking pixel or analytics beacon
function isTrackingPixel(url) {
  const trackingPatterns = [
    'bat.bing.com',
    'google-analytics.com',
    'googletagmanager.com',
    'facebook.com/tr',
    'doubleclick.net',
    'analytics.',
    '/pixel',
    '/beacon',
    'track.php',
    'collect?'
  ];
  return trackingPatterns.some(pattern => url.toLowerCase().includes(pattern));
}

// Check if status code is actually successful (including special cases)
function isSuccessStatus(status) {
  // All 2xx codes are successful
  if (typeof status === 'number' && status >= 200 && status < 300) {
    return true;
  }
  // 304 Not Modified is also success (cached content)
  if (status === 304) {
    return true;
  }
  return false;
}

// Check link status with real browser for affiliate links (ONLY check if opens)
async function checkLinkWithBrowser(url, browser) {
  let page;
  try {
    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    const startTime = Date.now();

    // Just check if the link opens - don't wait for full load
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded', // Faster - just check if it loads
      timeout: 15000
    });

    const finalUrl = page.url();
    const responseTime = Date.now() - startTime;
    const status = response.status();

    await page.close();

    return {
      status: status,
      statusText: response.statusText(),
      responseTime,
      redirectCount: 0,
      finalUrl,
      checkedWithBrowser: true,
      isAffiliate: true
    };
  } catch (error) {
    if (page) await page.close().catch(() => {});
    return {
      status: 'ERROR',
      statusText: error.message,
      responseTime: 0,
      checkedWithBrowser: true,
      isAffiliate: true
    };
  }
}

// Check link status with detailed error handling
async function checkLinkStatus(url, browser = null) {
  try {
    // Skip tracking pixels and analytics beacons
    if (isTrackingPixel(url)) {
      return {
        status: 200,
        statusText: 'Tracking Pixel',
        responseTime: 0,
        skip: true
      };
    }

    // Skip data URIs, blob URLs, and inline content
    if (url.startsWith('data:') || url.startsWith('blob:')) {
      return {
        status: 200,
        statusText: 'Inline Content',
        responseTime: 0,
        skip: true
      };
    }

    // Handle mailto and tel links
    if (url.startsWith('mailto:')) {
      const emailPattern = /^mailto:[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      return {
        status: emailPattern.test(url) ? 200 : 'Invalid',
        statusText: emailPattern.test(url) ? 'Valid Email' : 'Malformed Email',
        responseTime: 0
      };
    }

    if (url.startsWith('tel:')) {
      return {
        status: 200,
        statusText: 'Phone Link',
        responseTime: 0
      };
    }

    // Handle javascript: and # links
    if (url.startsWith('javascript:') || url.startsWith('#')) {
      return {
        status: 200,
        statusText: 'Internal Reference',
        responseTime: 0
      };
    }

    // Use browser for affiliate/tracking links
    if (browser && isAffiliateLink(url)) {
      console.log(`Checking affiliate link with browser: ${url}`);
      const result = await checkLinkWithBrowser(url, browser);

      // IMPORTANT: Only ignore 403 on affiliate links
      // Other errors (404, 500, DNS, etc.) are STILL REPORTED
      if (result.status === 403) {
        console.log(`⚠️ 403 on affiliate link (likely anti-bot) - will be filtered out`);
        return {
          ...result,
          treatAsWorking: true, // Flag for later filtering
          statusText: 'Anti-bot protection (link works in browsers)'
        };
      }

      return result;
    }

    // Standard HTTP check for regular links
    const startTime = Date.now();
    const response = await axios.get(url, {
      timeout: 10000,
      maxRedirects: 5,
      validateStatus: () => true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    });

    const responseTime = Date.now() - startTime;

    return {
      status: response.status,
      statusText: response.statusText,
      responseTime,
      redirectCount: response.request._redirectable?._redirectCount || 0,
      finalUrl: response.request.res?.responseUrl || url
    };
  } catch (error) {
    if (error.code === 'ENOTFOUND') {
      return { status: 'DNS_ERROR', statusText: 'Domain not found', responseTime: 0 };
    }
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
      return { status: 'TIMEOUT', statusText: 'Request timeout', responseTime: 10000 };
    }
    if (error.code === 'ECONNREFUSED') {
      return { status: 'CONNECTION_REFUSED', statusText: 'Connection refused', responseTime: 0 };
    }
    if (error.response) {
      return {
        status: error.response.status,
        statusText: error.response.statusText,
        responseTime: 0
      };
    }
    return { status: 'ERROR', statusText: error.message, responseTime: 0 };
  }
}

// AI Analysis using Claude API
async function analyzeWithAI(linkData) {
  const cacheKey = `${linkData.linkText}-${linkData.linkUrl}-${linkData.context}`;

  if (analysisCache.has(cacheKey)) {
    return analysisCache.get(cacheKey);
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `Analyze this link briefly:
Link Text: "${linkData.linkText}"
Link URL: ${linkData.linkUrl}
Context: ${linkData.context}
Status: ${linkData.status}

Reply with:
ANALYSIS: [Brief 1 sentence analysis]
SUGGESTED_FIX: [URL or "None"]
ISSUE_TYPE: [Broken Link, Context Mismatch, Redirect Chain, or No Issue]
PRIORITY: [Critical, High, Medium, or Low]`
        }]
      })
    });

    if (!response.ok) {
      console.error('AI API error:', response.status, response.statusText);
      return null;
    }

    const data = await response.json();

    // Check if response has content
    if (!data.content || !Array.isArray(data.content) || data.content.length === 0) {
      console.error('AI API returned invalid response:', data);
      return null;
    }

    const aiResponse = data.content[0].text;

    const analysisMatch = aiResponse.match(/ANALYSIS: (.+)/);
    const fixMatch = aiResponse.match(/SUGGESTED_FIX: (.+)/);
    const typeMatch = aiResponse.match(/ISSUE_TYPE: (.+)/);
    const priorityMatch = aiResponse.match(/PRIORITY: (.+)/);

    const result = {
      analysis: analysisMatch ? analysisMatch[1].trim() : 'Unable to analyze',
      suggestedFix: fixMatch && fixMatch[1].trim() !== 'None' ? fixMatch[1].trim() : null,
      issueType: typeMatch ? typeMatch[1].trim() : 'Unknown',
      priority: priorityMatch ? priorityMatch[1].trim() : 'Low'
    };

    analysisCache.set(cacheKey, result);
    return result;
  } catch (error) {
    console.error('AI Analysis error:', error.message);
    return null;
  }
}

// Fallback priority determination
function determinePriorityFromStatus(status) {
  if (status === 404 || status === 500 || status === 'ERROR') return 'Critical';
  if (status === 403 || status === 401 || status === 'TIMEOUT') return 'High';
  if (status >= 300 && status < 400) return 'Medium';
  return 'Low';
}

// Get issue type from status
function getIssueType(status) {
  if (status === 404) return 'Broken Link (404)';
  if (status === 403) return 'Access Forbidden (403)';
  if (status === 401) return 'Unauthorized (401)';
  if (status === 500 || status >= 500) return 'Server Error (500+)';
  if (status === 'TIMEOUT') return 'Timeout Error';
  if (status === 'DNS_ERROR') return 'DNS Error';
  if (status === 'CONNECTION_REFUSED') return 'Connection Refused';
  if (status === 'ERROR') return 'Connection Error';
  if (status === 304) return 'Not Modified (Cached)';
  if (status >= 300 && status < 400) return 'Redirect';
  return 'Unknown Issue';
}

// Calculate impact score
function calculateImpactScore(linkData, appearanceCount) {
  let score = 50;

  if (linkData.status === 404) score += 30;
  else if (linkData.status >= 500) score += 35;
  else if (linkData.status === 403) score += 20;
  else if (linkData.status >= 300 && linkData.status < 400) score += 10;

  if (linkData.context.toLowerCase().includes('cta') ||
      linkData.context.toLowerCase().includes('button')) score += 20;
  if (linkData.context.toLowerCase().includes('hero') ||
      linkData.context.toLowerCase().includes('header')) score += 15;
  if (linkData.context.toLowerCase().includes('navigation')) score += 10;

  score += Math.min(appearanceCount * 5, 20);

  return Math.min(Math.max(score, 0), 100);
}

// Take screenshot of page with error highlighted - VERIFIED WORKING VERSION
async function takeErrorScreenshot(pageUrl, linkText, linkUrl, browser) {
  let page = null;

  try {
    console.log(`\n📸 SCREENSHOT ATTEMPT for "${linkText}"`);
    console.log(`   Page: ${pageUrl}`);
    console.log(`   Target URL: ${linkUrl}`);

    // Step 1: Create new page with unique identifier
    console.log(`   → Step 1: Creating fresh browser page...`);
    page = await browser.newPage();

    // Disable cache to ensure fresh screenshot each time
    await page.setCacheEnabled(false);

    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    console.log(`   ✅ Page created (cache disabled)`);

    // Step 2: Navigate to page (with timeout handling)
    console.log(`   → Step 2: Navigating to page...`);
    try {
      await page.goto(pageUrl, {
        waitUntil: 'domcontentloaded', // Just DOM, not full resources
        timeout: 30000
      });
      console.log(`   ✅ Page loaded successfully`);
    } catch (navError) {
      console.log(`   ⚠️ Navigation timeout/error, continuing anyway: ${navError.message}`);
      // DON'T THROW - continue with whatever loaded
    }

    // Step 3: Wait for page to settle
    console.log(`   → Step 3: Waiting for page to settle (1.5s)...`);
    await new Promise(resolve => setTimeout(resolve, 1500));
    console.log(`   ✅ Page settled`);

    // Step 4: Inject CSS with unique ID to avoid conflicts
    console.log(`   → Step 4: Injecting highlight CSS...`);
    const uniqueId = `broken-link-${Date.now()}`;
    try {
      await page.evaluate((id) => {
        // Remove any existing highlight styles
        const existingStyles = document.querySelectorAll('[id^="broken-link-"]');
        existingStyles.forEach(s => s.remove());

        // Remove any existing highlights
        const existingHighlights = document.querySelectorAll('.broken-link-highlight');
        existingHighlights.forEach(el => el.classList.remove('broken-link-highlight'));

        const style = document.createElement('style');
        style.id = id;
        style.textContent = `
          .broken-link-highlight {
            outline: 6px solid #ff0000 !important;
            outline-offset: 4px !important;
            background-color: rgba(255, 0, 0, 0.3) !important;
            position: relative !important;
            box-shadow: 0 0 40px rgba(255, 0, 0, 1) !important;
            z-index: 999998 !important;
          }
          .broken-link-highlight::before {
            content: "❌ BROKEN LINK" !important;
            display: block !important;
            position: absolute !important;
            top: -45px !important;
            left: 0 !important;
            background: #ff0000 !important;
            color: #ffffff !important;
            padding: 12px 20px !important;
            font-size: 16px !important;
            font-weight: bold !important;
            font-family: Arial, sans-serif !important;
            border-radius: 8px !important;
            z-index: 999999 !important;
            box-shadow: 0 4px 15px rgba(0,0,0,0.5) !important;
            white-space: nowrap !important;
          }
        `;
        document.head.appendChild(style);
      }, uniqueId);
      console.log(`   ✅ CSS injected successfully (ID: ${uniqueId})`);
    } catch (cssError) {
      console.log(`   ⚠️ CSS injection warning: ${cssError.message}`);
      // Continue anyway
    }

    // Step 5: Find and highlight link (with fallback strategies)
    console.log(`   → Step 5: Searching for link to highlight...`);
    console.log(`      Looking for text: "${linkText}"`);
    console.log(`      Looking for URL pattern: "${linkUrl.substring(0, 80)}..."`);

    const highlightResult = await page.evaluate((searchText, searchUrl) => {
      try {
        const allElements = Array.from(document.querySelectorAll('a, img[src], button, [role="button"]'));
        let found = false;
        let usedStrategy = 'none';
        let matchedElement = null;

        // Strategy 1: Exact text match (case-insensitive)
        for (const el of allElements) {
          const elementText = (el.innerText || el.alt || el.textContent || '').trim();
          if (elementText && elementText.toLowerCase() === searchText.toLowerCase()) {
            el.classList.add('broken-link-highlight');
            el.scrollIntoView({ behavior: 'auto', block: 'center' });
            found = true;
            usedStrategy = 'exact-text';
            matchedElement = elementText;
            break;
          }
        }

        // Strategy 2: Partial text match (if search text is meaningful)
        if (!found && searchText.length > 3) {
          for (const el of allElements) {
            const elementText = (el.innerText || el.alt || el.textContent || '').trim().toLowerCase();
            const searchLower = searchText.toLowerCase();
            if (elementText && elementText.includes(searchLower)) {
              el.classList.add('broken-link-highlight');
              el.scrollIntoView({ behavior: 'auto', block: 'center' });
              found = true;
              usedStrategy = 'partial-text';
              matchedElement = elementText;
              break;
            }
          }
        }

        // Strategy 3: URL match (check href or src)
        if (!found) {
          for (const el of allElements) {
            const elementUrl = el.href || el.src || '';
            if (elementUrl && searchUrl) {
              // Try to match URL patterns
              const urlParts = searchUrl.split('?')[0]; // Remove query params
              if (elementUrl.includes(urlParts) || searchUrl.includes(elementUrl)) {
                el.classList.add('broken-link-highlight');
                el.scrollIntoView({ behavior: 'auto', block: 'center' });
                found = true;
                usedStrategy = 'url-match';
                matchedElement = elementUrl.substring(0, 50);
                break;
              }
            }
          }
        }

        // Strategy 4: Show banner if link not found on page
        if (!found) {
          // Remove any existing banners first
          const existingBanners = document.querySelectorAll('[id^="broken-link-banner"]');
          existingBanners.forEach(b => b.remove());

          const banner = document.createElement('div');
          banner.id = `broken-link-banner-${Date.now()}`;
          banner.style.cssText = `
            position: fixed !important;
            top: 20px !important;
            left: 50% !important;
            transform: translateX(-50%) !important;
            background: #ff0000 !important;
            color: white !important;
            padding: 20px 30px !important;
            border-radius: 10px !important;
            font-family: Arial, sans-serif !important;
            font-size: 18px !important;
            font-weight: bold !important;
            z-index: 999999 !important;
            box-shadow: 0 5px 20px rgba(0,0,0,0.6) !important;
            text-align: center !important;
            max-width: 80% !important;
          `;
          banner.innerHTML = `❌ BROKEN LINK: "${searchText}"<br><span style="font-size:14px;font-weight:normal;margin-top:8px;display:block;">Link not visible on page (may be hidden or loaded dynamically)</span>`;
          document.body.insertBefore(banner, document.body.firstChild);
          found = true;
          usedStrategy = 'banner';
          matchedElement = 'banner-shown';
        }

        return {
          success: found,
          strategy: usedStrategy,
          totalElements: allElements.length,
          matchedText: matchedElement
        };
      } catch (err) {
        return {
          success: false,
          strategy: 'error',
          error: err.message
        };
      }
    }, linkText, linkUrl);

    console.log(`   ✅ Highlight result: ${JSON.stringify(highlightResult)}`);

    // Step 6: Wait for rendering
    console.log(`   → Step 6: Waiting for highlights to render (1s)...`);
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log(`   ✅ Highlights rendered`);

    // Step 7: Capture screenshot
    console.log(`   → Step 7: Capturing screenshot...`);
    const screenshot = await page.screenshot({
      encoding: 'base64',
      fullPage: false,
      type: 'png'
    });

    const sizeKB = Math.round(screenshot.length / 1024);
    console.log(`   ✅ SUCCESS! Screenshot captured (${sizeKB} KB)`);
    console.log(`   Strategy used: ${highlightResult.strategy}\n`);

    // Clean up
    await page.close();
    return screenshot;

  } catch (error) {
    console.log(`   ❌ FAILED: ${error.message}`);
    console.log(`   Error stack: ${error.stack}\n`);

    if (page) {
      try {
        await page.close();
      } catch (closeError) {
        console.log(`   ⚠️ Page close error (ignoring): ${closeError.message}`);
      }
    }

    return null;
  }
}

// Crawl website and extract all links
async function crawlWebsite(domain, maxPages = 50) {
  const visited = new Set();
  const toVisit = [domain];
  const allLinks = [];
  const baseDomain = new URL(domain).hostname;

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',  // Overcome limited resource problems
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',  // Critical for Replit
      '--disable-gpu'
    ]
  });

  try {
    while (toVisit.length > 0 && visited.size < maxPages) {
      const currentUrl = toVisit.shift();

      if (visited.has(currentUrl)) continue;
      visited.add(currentUrl);

      console.log(`Crawling: ${currentUrl}`);

      try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

        await page.goto(currentUrl, {
          waitUntil: 'networkidle2',
          timeout: 30000
        });

        const links = await page.evaluate(() => {
          const results = [];
          const elements = document.querySelectorAll('a[href], img[src], link[href], script[src]');

          elements.forEach(el => {
            let url, text, type;

            if (el.tagName === 'A') {
              url = el.href;
              text = el.innerText.trim() || el.getAttribute('aria-label') || 'No text';
              type = 'link';
            } else if (el.tagName === 'IMG') {
              url = el.src;
              text = el.alt || 'Image';
              type = 'image';
            } else if (el.tagName === 'LINK') {
              url = el.href;
              text = 'Stylesheet';
              type = 'css';
            } else if (el.tagName === 'SCRIPT') {
              url = el.src;
              text = 'Script';
              type = 'script';
            }

            if (!url) return;

            let context = 'Unknown';
            let parent = el.closest('header, nav, footer, main, section, aside, div');

            if (parent) {
              const classes = parent.className || '';
              const id = parent.id || '';
              context = `${parent.tagName.toLowerCase()}${id ? '#' + id : ''}${classes ? '.' + classes.split(' ')[0] : ''}`;
            }

            if (el.classList && (el.classList.contains('btn') ||
                el.classList.contains('button') ||
                el.classList.contains('cta'))) {
              context += ' - CTA button';
            }

            results.push({ url, text, context, type });
          });

          return results;
        });

        allLinks.push(...links.map(link => ({
          ...link,
          pageUrl: currentUrl
        })));

        // IMPORTANT: Only crawl internal links from same domain
        // Do NOT crawl affiliate destinations
        const internalLinks = links
          .filter(link => {
            if (link.type !== 'link') return false;
            // Skip affiliate links - don't crawl their destinations
            if (isAffiliateLink(link.url)) return false;
            try {
              const linkHostname = new URL(link.url).hostname;
              return linkHostname === baseDomain;
            } catch {
              return false;
            }
          })
          .map(link => link.url);

        internalLinks.forEach(link => {
          if (!visited.has(link) && !toVisit.includes(link)) {
            toVisit.push(link);
          }
        });

        await page.close();
      } catch (error) {
        console.error(`Error crawling ${currentUrl}:`, error.message);
      }
    }
  } finally {
    await browser.close();
  }

  return { pages: Array.from(visited), links: allLinks };
}

// Main scan endpoint
app.post('/api/scan', async (req, res) => {
  const { domain } = req.body;

  if (!domain || !isValidUrl(domain)) {
    return res.status(400).json({ error: 'Invalid domain URL' });
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`🚀 Starting scan for: ${domain}`);
  console.log(`${'='.repeat(60)}\n`);

  let affiliateBrowser = null;
  let screenshotBrowser = null;

  try {
    // Step 1: Crawl website
    const { pages, links } = await crawlWebsite(domain);
    console.log(`\n✅ Crawled ${pages.length} pages, found ${links.length} links\n`);

    // Launch browsers for affiliate checking and screenshots
    affiliateBrowser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    screenshotBrowser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    // Step 2: Count link appearances
    const linkAppearances = new Map();
    links.forEach(link => {
      const key = link.url;
      linkAppearances.set(key, (linkAppearances.get(key) || 0) + 1);
    });

    // Step 3: Check each unique link
    const uniqueLinks = Array.from(new Set(links.map(l => l.url)))
      .map(url => links.find(l => l.url === url));

    const results = [];
    let processed = 0;

    console.log(`🔍 Checking ${uniqueLinks.length} unique links...\n`);

    for (const link of uniqueLinks) {
      console.log(`[${++processed}/${uniqueLinks.length}] ${link.url.substring(0, 80)}...`);

      const statusInfo = await checkLinkStatus(link.url, affiliateBrowser);

      if (statusInfo.skip) {
        console.log(`   ℹ️ Skipped (tracking pixel or inline content)\n`);
        continue;
      }

      const appearanceCount = linkAppearances.get(link.url);

      // Only analyze problematic links
      let aiAnalysis = null;
      const needsAnalysis =
        statusInfo.status !== 200 ||
        statusInfo.redirectCount > 0 ||
        link.context.toLowerCase().includes('cta') ||
        link.context.toLowerCase().includes('button');

      if (needsAnalysis) {
        aiAnalysis = await analyzeWithAI({
          linkText: link.text,
          linkUrl: link.url,
          context: link.context,
          status: statusInfo.status
        });
      }

      const impactScore = calculateImpactScore(
        { ...link, status: statusInfo.status },
        appearanceCount
      );

      // Determine if this is actually an issue that should be reported
      const isActualIssue = (
        !isSuccessStatus(statusInfo.status) &&      // Not a success code (200-299, 304)
        !statusInfo.treatAsWorking &&                // Not flagged as working (403 on affiliate)
        statusInfo.status !== 200 &&                 // Not explicitly 200
        !(typeof statusInfo.status === 'number' &&   // Not just a simple redirect
          statusInfo.status >= 300 &&
          statusInfo.status < 400)
      );

      // Special handling: Skip 403 on affiliate links entirely
      if (statusInfo.status === 403 && statusInfo.isAffiliate) {
        console.log(`   ℹ️ Skipping 403 on affiliate link (anti-bot protection)\n`);
        continue; // Don't add to results at all
      }

      // Skip 304 Not Modified - it's a success status
      if (statusInfo.status === 304) {
        console.log(`   ℹ️ Skipping 304 Not Modified (cached content - working correctly)\n`);
        continue; // Don't add to results at all
      }

      if (isActualIssue || (aiAnalysis && aiAnalysis.issueType !== 'No Issue')) {
        let friendlyMessage = '';

        if (statusInfo.status === 404) {
          friendlyMessage = `Page not found (404). This link is broken and leads nowhere.`;
        } else if (statusInfo.status === 403) {
          // This should only show for NON-affiliate 403s now
          friendlyMessage = `Access forbidden (403). The server is blocking access to this page.`;
        } else if (statusInfo.status === 500) {
          friendlyMessage = `Server error (500). The destination server has internal problems.`;
        } else if (statusInfo.status === 'TIMEOUT') {
          friendlyMessage = `Request timeout. The page took too long to respond.`;
        } else if (statusInfo.status === 'DNS_ERROR') {
          friendlyMessage = `Domain not found. The website address doesn't exist.`;
        } else if (statusInfo.status === 'CONNECTION_REFUSED') {
          friendlyMessage = `Connection refused. The server is not accepting connections.`;
        } else if (statusInfo.status === 'ERROR') {
          friendlyMessage = `Connection error: ${statusInfo.statusText}`;
        } else if (statusInfo.redirectCount > 0 && statusInfo.status >= 300 && statusInfo.status < 400) {
          friendlyMessage = `Working but has ${statusInfo.redirectCount} redirect(s) which may slow page load.`;
        } else {
          friendlyMessage = aiAnalysis?.analysis || `Link returned ${statusInfo.status} status`;
        }

        if (statusInfo.isAffiliate) {
          friendlyMessage += ` [Affiliate link - only checked if it opens, destination not scanned]`;
        } else if (statusInfo.checkedWithBrowser) {
          friendlyMessage += ` (Verified with browser)`;
        }

        // Take screenshots for REAL errors (including broken affiliate links)
        // Only skip screenshots for 403 on affiliate (anti-bot) and cached 304
        let screenshot = null;
        const shouldTakeScreenshot = (
          (statusInfo.status === 404 ||
           statusInfo.status === 500 ||
           statusInfo.status === 'ERROR' ||
           statusInfo.status === 'DNS_ERROR' ||
           statusInfo.status === 'TIMEOUT') &&
          !statusInfo.treatAsWorking  // Don't screenshot 403 anti-bot
        );

        if (shouldTakeScreenshot) {
          console.log(`   🔍 Taking screenshot for ${statusInfo.status} error on: ${link.pageUrl}`);
          console.log(`   📸 Link: "${link.text}" → ${link.url}`);
          screenshot = await takeErrorScreenshot(link.pageUrl, link.text, link.url, screenshotBrowser);

          if (screenshot) {
            console.log(`   ✅ Screenshot captured successfully (${Math.round(screenshot.length / 1024)} KB)`);
          } else {
            console.log(`   ❌ Screenshot capture failed`);
          }
        } else {
          console.log(`   ℹ️ Screenshot skipped for status ${statusInfo.status} (not a critical visual error)`);
        }

        console.log(`   ❌ Issue found: ${statusInfo.status} - ${friendlyMessage.substring(0, 80)}...\n`);

        results.push({
          id: results.length + 1,
          pageUrl: link.pageUrl,
          linkText: link.text,
          linkUrl: link.url,
          status: statusInfo.status,
          statusText: statusInfo.statusText,
          responseTime: statusInfo.responseTime,
          redirectCount: statusInfo.redirectCount || 0,
          finalUrl: statusInfo.finalUrl || link.url,
          priority: aiAnalysis?.priority || determinePriorityFromStatus(statusInfo.status),
          type: aiAnalysis?.issueType || getIssueType(statusInfo.status),
          context: link.context,
          aiAnalysis: friendlyMessage,
          suggestedFix: aiAnalysis?.suggestedFix || null,
          impactScore,
          appearancesCount: appearanceCount,
          linkType: link.type,
          screenshot: screenshot
        });
      } else {
        console.log(`   ✅ OK (${statusInfo.status})\n`);
      }
    }

    // Calculate health score
    const totalLinks = links.length;
    const issueLinks = results.length;
    const healthScore = Math.round(((totalLinks - issueLinks) / totalLinks) * 100);

    // Calculate stats
    const stats = {
      totalPages: pages.length,
      totalLinks: totalLinks,
      brokenLinks: issueLinks,
      criticalIssues: results.filter(r => r.priority === 'Critical').length,
      highIssues: results.filter(r => r.priority === 'High').length,
      avgImpactScore: results.length > 0
        ? Math.round(results.reduce((acc, r) => acc + r.impactScore, 0) / results.length)
        : 0
    };

    console.log(`\n${'='.repeat(60)}`);
    console.log(`✅ SCAN COMPLETE`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Health Score: ${healthScore}/100`);
    console.log(`Total Links: ${totalLinks}`);
    console.log(`Issues Found: ${issueLinks}`);
    console.log(`Critical: ${stats.criticalIssues} | High: ${stats.highIssues}`);
    console.log(`${'='.repeat(60)}\n`);

    res.json({
      healthScore,
      stats,
      results: results.sort((a, b) => {
        const priorityOrder = { 'Critical': 0, 'High': 1, 'Medium': 2, 'Low': 3 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }),
      pages
    });

  } catch (error) {
    console.error('❌ Scan error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    if (affiliateBrowser) {
      await affiliateBrowser.close();
    }
    if (screenshotBrowser) {
      await screenshotBrowser.close();
    }
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const path = require('path');

// Serve static files from React build (for production)
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../frontend/build')));

  // Serve React app for all non-API routes
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(__dirname, '../frontend/build', 'index.html'));
    }
  });
}

app.listen(PORT, HOST, () => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🚀 Link Checker Backend running on http://${HOST}:${PORT}`);
  console.log(`✅ Ready to scan websites!`);
  console.log(`${'='.repeat(60)}\n`);
});