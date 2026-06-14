require('dotenv').config();
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

const API_URL = 'https://elibrary.sansad.in/server/api/discover/search/objects';
const BASE_URL = 'https://elibrary.sansad.in/server/api/core';
const COLLECTION_ID = '571cd23f-4973-410f-a639-dabb4cbd805b';
const PROCESSED_FILE = 'processed.json';

// How many NEW reports to process per run.
// Keep this at 5 to stay well under Gemini's 250/day free tier limit.
const BATCH_SIZE = 5;

// Delay between Gemini calls in milliseconds.
// 7 seconds = ~8 calls/min, safely under the 10 RPM free tier limit.
const DELAY_MS = 7000;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ─── Utility: sleep ───────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Tracking: load and save processed UUIDs ─────────────────────────────────

function loadProcessed() {
  if (!fs.existsSync(PROCESSED_FILE)) {
    fs.writeFileSync(PROCESSED_FILE, '[]', 'utf8');
    return new Set();
  }
  const data = JSON.parse(fs.readFileSync(PROCESSED_FILE, 'utf8'));
  return new Set(data);
}

function saveProcessed(processedSet) {
  const arr = Array.from(processedSet);
  fs.writeFileSync(PROCESSED_FILE, JSON.stringify(arr, null, 2), 'utf8');
}

// ─── API: fetch a page of reports from DSpace ────────────────────────────────

async function fetchReportPage(page, size) {
  const response = await axios.get(API_URL, {
    params: { scope: COLLECTION_ID, page, size }
  });
  return response.data._embedded.searchResult._embedded.objects;
}

// ─── API: get total number of reports available ───────────────────────────────

async function getTotalReports() {
  const response = await axios.get(API_URL, {
    params: { scope: COLLECTION_ID, page: 0, size: 1 }
  });
  return response.data._embedded.searchResult.page.totalElements;
}

// ─── API: fetch the full text content of a report item ───────────────────────

async function getTextContent(itemId) {
  const bundlesRes = await axios.get(`${BASE_URL}/items/${itemId}/bundles`);
  const bundles = bundlesRes.data._embedded.bundles;

  const textBundle = bundles.find(b => b.name === 'TEXT');
  if (!textBundle) return null;

  const bitstreamsRes = await axios.get(`${BASE_URL}/bundles/${textBundle.uuid}/bitstreams`);
  const bitstreams = bitstreamsRes.data._embedded.bitstreams;
  if (!bitstreams || bitstreams.length === 0) return null;

  const retrieveUrl = `${BASE_URL}/bitstreams/${bitstreams[0].uuid}/content`;
  const textRes = await axios.get(retrieveUrl);
  return textRes.data;
}

// ─── Gemini: generate plain-English article ───────────────────────────────────

async function generateArticle(reportText, metadata) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const prompt = `
You are helping Indian citizens understand parliamentary committee reports.

You will be given the full text of a committee report. Your job is to summarise it accurately.

STRICT RULES — you must follow all of these without exception:
- Use ONLY information explicitly stated in the report text below. Do not add anything else.
- Do not use your general knowledge about India, Parliament, or any topic.
- Do not infer, extrapolate, or assume anything not written in the report.
- If something is unclear or not mentioned in the report, write: "The report does not specify this."
- Do not express any opinion on whether recommendations are good, bad, important, or significant.
- Use plain language. If you must use a technical or legal term, explain it immediately in the same sentence.
- When mentioning any event, decision, or action, include the date if the report mentions one.

REPORT METADATA (use these facts directly in your article):
- Title: ${metadata.title}
- Committee: ${metadata.committee}
- Date of Report: ${metadata.date}
- Lok Sabha Number: ${metadata.loksabha}
- Report Number: ${metadata.reportNumber}
- Type: ${metadata.type}

Write the article in exactly this structure:

## [Write a plain, factual headline based only on what the report actually covers]

**Report date:** ${metadata.date}
**Committee:** ${metadata.committee}
**Lok Sabha:** ${metadata.loksabha}

### What was discussed
[2-3 paragraphs. What topic did the committee examine? Dates mentioned in the report should be included.]

### What the report found
[What did the committee observe or note? Specific findings only, as stated in the report.]

### What was recommended
[Bullet points. One recommendation per bullet, in plain language, exactly as the report states it.]

### What it means for citizens
[1-2 paragraphs. Practical implications for ordinary people, based strictly on what the report says.]

---
*This summary was generated using AI and may contain errors. Always read the original report before drawing conclusions.*

**Source:** [${metadata.title}](${metadata.sourceUrl})

Here is the full report text:
${reportText}
`;

  const result = await model.generateContent(prompt);
  return result.response.text();
}

// ─── HTML: convert markdown to HTML ──────────────────────────────────────────

function markdownToHtml(markdown) {
  let html = markdown;

  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank">$1</a>');
  html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>[\s\S]+?<\/li>)(\s*<li>[\s\S]+?<\/li>)*/g, (match) => `<ul>${match}</ul>`);
  html = html.replace(/^---$/gm, '<hr>');
  html = html.replace(/^(?!<[hul\/]|<li|<hr)(.+)$/gm, '<p>$1</p>');
  html = html.replace(/\n{2,}/g, '\n');

  return html;
}

// ─── HTML: save a report as a standalone HTML page ───────────────────────────

function saveHtmlPage(article, metadata) {
  const slug = metadata.uuid;
  const filePath = path.join('site', 'reports', `${slug}.html`);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${metadata.title} — Sansad for Citizens</title>
  <style>
    body {
      font-family: Georgia, serif;
      max-width: 720px;
      margin: 60px auto;
      padding: 0 24px;
      color: #1a1a1a;
      line-height: 1.8;
      font-size: 18px;
    }
    h2 { font-size: 28px; line-height: 1.3; margin-bottom: 8px; }
    h3 { font-size: 20px; margin-top: 40px; }
    .meta { color: #666; font-size: 15px; margin-bottom: 32px; font-family: sans-serif; }
    ul { padding-left: 24px; }
    li { margin-bottom: 8px; }
    hr { border: none; border-top: 1px solid #ddd; margin: 40px 0; }
    .disclaimer { font-size: 14px; color: #888; font-family: sans-serif; }
    a { color: #1a1a1a; }
    .back { font-family: sans-serif; font-size: 14px; margin-bottom: 40px; }
    .back a { color: #555; text-decoration: none; }
    .back a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="back"><a href="../index.html">← All reports</a></div>
  <div class="meta">
    ${metadata.committee} &nbsp;·&nbsp; ${metadata.date} &nbsp;·&nbsp; ${metadata.type}
  </div>
  ${markdownToHtml(article)}
</body>
</html>`;

  fs.writeFileSync(filePath, html, 'utf8');
  console.log(`  Saved: ${filePath}`);
  return filePath;
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

async function main() {
  const processed = loadProcessed();
  console.log(`Already processed: ${processed.size} report(s)`);

  const total = await getTotalReports();
  console.log(`Total reports in collection: ${total}`);

  let newCount = 0;
  let page = 0;
  const pageSize = 20; // fetch 20 at a time from the API to find unprocessed ones

  while (newCount < BATCH_SIZE) {
    console.log(`\nFetching API page ${page}...`);
    const objects = await fetchReportPage(page, pageSize);

    if (!objects || objects.length === 0) {
      console.log('No more reports available from API.');
      break;
    }

    for (const obj of objects) {
      if (newCount >= BATCH_SIZE) break;

      const item = obj._embedded.indexableObject;
      const meta = item.metadata;
      const uuid = item.uuid;

      if (processed.has(uuid)) {
        console.log(`  Skipping (already done): ${item.name}`);
        continue;
      }

      console.log(`\nProcessing: ${item.name}`);

      const metadata = {
        uuid,
        title: item.name,
        committee: meta['dc.contributor.committeename']?.[0]?.value || 'Not specified',
        date: meta['dc.date.issued']?.[0]?.value || 'Not specified',
        loksabha: meta['dc.identifier.loksabhanumber']?.[0]?.value || 'Not specified',
        reportNumber: meta['dc.identifier.reportnumber']?.[0]?.value || 'Not specified',
        type: meta['dc.type']?.[0]?.value || 'Not specified',
        sourceUrl: meta['dc.identifier.uri']?.[0]?.value || 'https://elibrary.sansad.in'
      };

      // Step 1: fetch full text
      console.log('  Fetching text content...');
      const text = await getTextContent(uuid);
      if (!text) {
        console.log('  No text found — skipping this report.');
        // Mark as processed so we don't keep retrying a report with no text
        processed.add(uuid);
        saveProcessed(processed);
        continue;
      }
      console.log(`  Text length: ${text.length} characters`);

      // Step 2: call Gemini
      console.log('  Calling Gemini...');
      const article = await generateArticle(text, metadata);

      // Step 3: save HTML
      saveHtmlPage(article, metadata);

      // Step 4: mark as processed immediately (crash-safe)
      processed.add(uuid);
      saveProcessed(processed);
      newCount++;

      console.log(`  Done (${newCount}/${BATCH_SIZE} new reports this run)`);

      // Step 5: wait before next Gemini call (rate limiting)
      if (newCount < BATCH_SIZE) {
        console.log(`  Waiting ${DELAY_MS / 1000}s before next report (rate limit)...`);
        await sleep(DELAY_MS);
      }
    }

    page++;

    // Safety: if we've gone through all available pages
    if (page * pageSize >= total) {
      console.log('\nAll available reports have been processed.');
      break;
    }
  }

  console.log(`\nRun complete. ${newCount} new report(s) processed this run.`);
}

main();