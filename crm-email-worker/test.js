import PostalMime from 'postal-mime';

async function runTest() {
  console.log('--- Testing PostalMime with Sample RFC822 Email ---');
  
  const sampleEml = `From: "Sarah Lin" <sarah.lin@apexglobal.io>
To: "Support" <support@devdesk.webmail.edge>
Subject: Inquiry Regarding Enterprise Tier Agreement
Date: Sat, 15 Aug 2026 10:00:00 +0000
Message-ID: <test-12345@apexglobal.io>
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="frontier"

--frontier
Content-Type: text/plain; charset=UTF-8

Hello CRM Team,

Could you please send over the latest enterprise tier SLA and pricing documentation?

Best regards,
Sarah Lin
Apex Global Technologies

--frontier
Content-Type: text/plain; name="requirements.txt"
Content-Disposition: attachment; filename="requirements.txt"

1. 50 Enterprise Seats
2. SIP Voice Trunk Integration
3. Dedicated SLA 99.99%

--frontier--`;

  const parser = new PostalMime();
  const parsed = await parser.parse(sampleEml);

  console.log('Subject:', parsed.subject);
  console.log('From:', parsed.from);
  console.log('To:', parsed.to);
  console.log('Text preview:', parsed.text.trim());
  console.log('Attachments found:', parsed.attachments?.length || 0);
  if (parsed.attachments?.length) {
    console.log('Attachment 1 filename:', parsed.attachments[0].filename);
    console.log('Attachment 1 size:', parsed.attachments[0].content?.byteLength, 'bytes');
  }

  console.log('✅ PostalMime parser test completed successfully!');
}

runTest().catch(console.error);
