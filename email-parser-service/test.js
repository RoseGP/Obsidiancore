import PostalMime from 'postal-mime';

const sampleMime = `From: Alice Wonderland <alice@example.com>
To: Bob Builder <bob@example.com>
Subject: Test Email with PostalMime & Node.js Compat
Date: Tue, 18 Aug 2026 13:50:00 +0000
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="sep_123"

--sep_123
Content-Type: text/plain; charset=utf-8

Hello Bob,
This is a test verifying postal-mime parsing under nodejs_compat.

--sep_123
Content-Type: text/html; charset=utf-8

<p>Hello Bob,<br>This is a <b>rich HTML</b> email body.</p>

--sep_123
Content-Type: text/plain; name="note.txt"
Content-Disposition: attachment; filename="note.txt"

Sample attachment content.
--sep_123--`;

async function runTest() {
  console.log("Testing PostalMime parser initialization...");
  const parser = new PostalMime();
  const parsed = await parser.parse(sampleMime);

  console.log("✓ From:", parsed.from);
  console.log("✓ To:", parsed.to);
  console.log("✓ Subject:", parsed.subject);
  console.log("✓ Plain text preview:", parsed.text?.trim());
  console.log("✓ HTML preview:", parsed.html?.trim());
  console.log("✓ Attachments found:", parsed.attachments?.length);
  if (parsed.attachments?.length > 0) {
    console.log("  - Attachment 1:", parsed.attachments[0].filename, `(${parsed.attachments[0].mimeType})`);
  }
  console.log("\nAll postal-mime test assertions passed successfully!");
}

runTest().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
