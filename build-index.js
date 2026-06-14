const fs = require('fs');
const path = require('path');

function buildIndex() {
  // Read all report HTML files
  const reportsDir = path.join('site', 'reports');
  const files = fs.readdirSync(reportsDir).filter(f => f.endsWith('.html'));

  if (files.length === 0) {
    console.log('No reports found.');
    return;
  }

  // Read metadata from each file's <title> and <div class="meta">
  const reports = files.map(file => {
    const content = fs.readFileSync(path.join(reportsDir, file), 'utf8');

    const titleMatch = content.match(/<title>(.+?) — Sansad for Citizens<\/title>/);
    const metaMatch = content.match(/<div class="meta">\s*(.+?)\s*<\/div>/s);
    const h2Match = content.match(/<h2>(.+?)<\/h2>/);

    return {
      file: file,
      title: h2Match ? h2Match[1] : (titleMatch ? titleMatch[1] : file),
      meta: metaMatch ? metaMatch[1].replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, '').trim() : ''
    };
  });

  const reportCards = reports.map(r => `
    <a class="card" href="reports/${r.file}">
      <div class="card-meta">${r.meta}</div>
      <div class="card-title">${r.title}</div>
      <div class="card-cta">Read summary →</div>
    </a>`).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sansad for Citizens</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: Georgia, serif;
      background: #fafafa;
      color: #1a1a1a;
    }

    header {
      border-bottom: 1px solid #e0e0e0;
      padding: 40px 24px 32px;
      max-width: 720px;
      margin: 0 auto;
    }

    header h1 {
      font-size: 28px;
      font-weight: bold;
      margin-bottom: 12px;
    }

    header p {
      font-size: 16px;
      color: #555;
      line-height: 1.6;
      max-width: 560px;
    }

    .notice {
      font-family: sans-serif;
      font-size: 13px;
      color: #888;
      margin-top: 12px;
    }

    main {
      max-width: 720px;
      margin: 0 auto;
      padding: 40px 24px;
    }

    .count {
      font-family: sans-serif;
      font-size: 14px;
      color: #888;
      margin-bottom: 24px;
    }

    .card {
      display: block;
      text-decoration: none;
      color: inherit;
      border: 1px solid #e0e0e0;
      border-radius: 6px;
      padding: 24px;
      margin-bottom: 16px;
      background: #fff;
      transition: border-color 0.15s;
    }

    .card:hover {
      border-color: #999;
    }

    .card-meta {
      font-family: sans-serif;
      font-size: 13px;
      color: #888;
      margin-bottom: 8px;
    }

    .card-title {
      font-size: 18px;
      line-height: 1.4;
      margin-bottom: 12px;
    }

    .card-cta {
      font-family: sans-serif;
      font-size: 13px;
      color: #555;
    }

    footer {
      border-top: 1px solid #e0e0e0;
      padding: 32px 24px;
      max-width: 720px;
      margin: 0 auto;
      font-family: sans-serif;
      font-size: 13px;
      color: #aaa;
    }
  </style>
</head>
<body>
  <header>
    <h1>Sansad for Citizens</h1>
    <p>Parliamentary committee reports, explained in plain English for every Indian citizen.</p>
    <p class="notice">Summaries are AI-generated. Always read the original report before drawing conclusions.</p>
  </header>

  <main>
    <div class="count">${reports.length} report${reports.length === 1 ? '' : 's'} published</div>
    ${reportCards}
  </main>

  <footer>
    Source: <a href="https://elibrary.sansad.in" target="_blank">Parliament of India Digital Library</a>
  </footer>
</body>
</html>`;

  fs.writeFileSync(path.join('site', 'index.html'), html, 'utf8');
  console.log(`Homepage built with ${reports.length} report(s).`);
}

buildIndex();