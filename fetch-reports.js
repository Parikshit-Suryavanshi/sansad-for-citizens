require('dotenv').config();
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

const API_URL = 'https://elibrary.sansad.in/server/api/discover/search/objects';
const BASE_URL = 'https://elibrary.sansad.in/server/api/core';
const COLLECTION_ID = '571cd23f-4973-410f-a639-dabb4cbd805b';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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

function markdownToHtml(markdown) {
  let html = markdown;

  // Convert headings first
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');

  // Bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Links
  html = html.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank">$1</a>');

  // Bullet points — handle both - and * style
  html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');

  // Wrap consecutive <li> items in <ul>
  html = html.replace(/(<li>[\s\S]+?<\/li>)(\s*<li>[\s\S]+?<\/li>)*/g, (match) => `<ul>${match}</ul>`);

  // Horizontal rule
  html = html.replace(/^---$/gm, '<hr>');

  // Paragraphs — wrap lines that aren't already HTML tags
  html = html.replace(/^(?!<[hul\/]|<li|<hr)(.+)$/gm, '<p>$1</p>');

  // Clean up blank lines
  html = html.replace(/\n{2,}/g, '\n');

  return html;
}

function saveHtmlPage(article, metadata) {
  const slug = metadata.uuid;
  const filePath = path.join('site', 'reports', `${slug}.html`);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${metadata.title} — Sansad in Plain Language</title>
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
  console.log(`Saved: ${filePath}`);
  return filePath;
}

async function main() {
  console.log('Fetching report from API...');
  const response = await axios.get(API_URL, {
    params: { scope: COLLECTION_ID, page: 0, size: 1 }
  });

  const obj = response.data._embedded.searchResult._embedded.objects[0];
  const item = obj._embedded.indexableObject;
  const meta = item.metadata;

  const metadata = {
    uuid: item.uuid,
    title: item.name,
    committee: meta['dc.contributor.committeename']?.[0]?.value || 'Not specified',
    date: meta['dc.date.issued']?.[0]?.value || 'Not specified',
    loksabha: meta['dc.identifier.loksabhanumber']?.[0]?.value || 'Not specified',
    reportNumber: meta['dc.identifier.reportnumber']?.[0]?.value || 'Not specified',
    type: meta['dc.type']?.[0]?.value || 'Not specified',
    sourceUrl: meta['dc.identifier.uri']?.[0]?.value || 'https://elibrary.sansad.in'
  };

  console.log('Report:', metadata.title);
  console.log('Fetching text content...');

  const text = await getTextContent(item.uuid);
  if (!text) {
    console.log('Could not retrieve text for this report.');
    return;
  }

  console.log(`Text length: ${text.length} characters`);
  console.log('Sending to Gemini...');

  const article = await generateArticle(text, metadata);
  saveHtmlPage(article, metadata);
}

main();