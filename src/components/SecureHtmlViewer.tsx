import React, { useState, useEffect, useRef } from 'react';
import DOMPurify from 'dompurify';
import { Eye, Shield, ShieldAlert, Image as ImageIcon } from 'lucide-react';

interface SecureHtmlViewerProps {
  html: string;
  id?: string;
}

export default function SecureHtmlViewer({ html, id }: SecureHtmlViewerProps) {
  const [blockImages, setBlockImages] = useState(true);
  const [iframeHeight, setIframeHeight] = useState(150);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Sanitize and handle external images
  const getProcessedHtml = () => {
    // 1. Sanitize using DOMPurify
    const sanitized = DOMPurify.sanitize(html, {
      ALLOWED_TAGS: [
        'p', 'b', 'i', 'em', 'strong', 'a', 'img', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'br', 'hr', 'blockquote', 'style'
      ],
      ALLOWED_ATTR: ['href', 'src', 'alt', 'style', 'class', 'width', 'height', 'target', 'align', 'valign'],
    });

    // 2. Parse into DOM to optionally block/rewrite image sources
    const parser = new DOMParser();
    const doc = parser.parseFromString(sanitized, 'text/html');
    const images = doc.querySelectorAll('img');

    let hasExternalImages = false;

    images.forEach((img) => {
      const src = img.getAttribute('src') || '';
      const isExternal = src.startsWith('http://') || src.startsWith('https://') || src.startsWith('//');
      
      if (isExternal) {
        hasExternalImages = true;
        if (blockImages) {
          // Store original src for easy restoration and render a placeholder
          img.setAttribute('data-original-src', src);
          img.setAttribute(
            'src',
            'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="%2394a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mx-auto"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>'
          );
          // Add custom styling inside iframe for blocked image
          const originalStyle = img.getAttribute('style') || '';
          img.setAttribute(
            'style',
            `${originalStyle}; border: 1px dashed #cbd5e1; background-color: #f8fafc; padding: 12px; display: inline-block; max-width: 100%; min-width: 120px; text-align: center; border-radius: 6px;`
          );
          // Set custom alt description
          if (!img.getAttribute('alt')) {
            img.setAttribute('alt', '[External Image Blocked]');
          }
        }
      }
    });

    return {
      htmlContent: doc.body.innerHTML,
      hasExternalImages,
    };
  };

  const { htmlContent, hasExternalImages } = getProcessedHtml();

  // Re-calculate iframe height based on content
  const updateIframeHeight = () => {
    const iframe = iframeRef.current;
    if (iframe && iframe.contentWindow && iframe.contentDocument) {
      const doc = iframe.contentDocument;
      // Force iframe scrollHeight recalculation
      const height = Math.max(
        doc.body.scrollHeight,
        doc.body.offsetHeight,
        doc.documentElement.clientHeight,
        doc.documentElement.scrollHeight,
        doc.documentElement.offsetHeight
      );
      if (height > 0) {
        setIframeHeight(height + 24); // add small padding
      }
    }
  };

  useEffect(() => {
    updateIframeHeight();
  }, [htmlContent, blockImages]);

  // Handle onload and resize observers for reliable resizing
  const handleIframeLoad = () => {
    updateIframeHeight();
    
    // Set up a ResizeObserver inside the iframe to capture lazy-loaded content or layout shifts
    const iframe = iframeRef.current;
    if (iframe && iframe.contentDocument && iframe.contentDocument.body) {
      try {
        const observer = new ResizeObserver(() => {
          updateIframeHeight();
        });
        observer.observe(iframe.contentDocument.body);
        return () => observer.disconnect();
      } catch (err) {
        // Fallback if ResizeObserver is unsupported or blocked by iframe security context
        console.warn('IFrame ResizeObserver not supported', err);
      }
    }
  };

  // Compile the full iframe document with custom typography style
  const docHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            font-size: 13.5px;
            line-height: 1.6;
            color: #1e293b;
            margin: 0;
            padding: 8px;
            background-color: transparent;
            word-wrap: break-word;
            overflow-wrap: break-word;
          }
          p { margin-top: 0; margin-bottom: 12px; }
          h1, h2, h3, h4, h5, h6 { 
            margin-top: 16px; 
            margin-bottom: 8px; 
            font-weight: 700; 
            color: #0f172a; 
            line-height: 1.25;
          }
          h1 { font-size: 1.5em; }
          h2 { font-size: 1.3em; }
          h3 { font-size: 1.15em; }
          a { 
            color: #5f5eed; 
            text-decoration: underline; 
            font-weight: 500;
          }
          a:hover {
            color: #4a49cc;
          }
          img { 
            max-width: 100%; 
            height: auto; 
            border-radius: 4px;
          }
          table { 
            border-collapse: collapse; 
            width: 100%; 
            margin-top: 12px; 
            margin-bottom: 16px; 
            font-size: 12.5px;
          }
          th, td { 
            border: 1px solid #e2e8f0; 
            padding: 8px 10px; 
            text-align: left; 
          }
          th { 
            background-color: #f8fafc; 
            font-weight: 600; 
            color: #334155;
          }
          tr:nth-child(even) {
            background-color: #fdfdfe;
          }
          ul, ol { 
            margin-top: 0; 
            margin-bottom: 12px; 
            padding-left: 20px; 
          }
          li { 
            margin-bottom: 4px; 
          }
          blockquote { 
            border-left: 3.5px solid #cbd5e1; 
            padding-left: 12px; 
            color: #64748b; 
            margin: 0 0 12px 0; 
            font-style: italic;
          }
          pre, code {
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            background-color: #f1f5f9;
            padding: 2px 4px;
            border-radius: 4px;
            font-size: 12px;
          }
          pre {
            padding: 12px;
            overflow-x: auto;
            margin-top: 0;
            margin-bottom: 12px;
          }
        </style>
      </head>
      <body>
        ${htmlContent}
      </body>
    </html>
  `;

  return (
    <div id={id} className="w-full border border-slate-200/80 rounded-2xl bg-white shadow-sm overflow-hidden flex flex-col">
      {/* Privacy Banner - Only display if external images are detected in email content */}
      {hasExternalImages && (
        <div className={`px-4 py-2.5 text-xs font-semibold flex items-center justify-between border-b transition-colors duration-200 ${
          blockImages 
            ? 'bg-slate-50 text-slate-700 border-slate-200' 
            : 'bg-amber-50/55 text-amber-800 border-amber-100'
        }`}>
          <div className="flex items-center gap-2">
            {blockImages ? (
              <Shield className="h-4 w-4 text-emerald-600 shrink-0 animate-pulse" />
            ) : (
              <ShieldAlert className="h-4 w-4 text-amber-600 shrink-0" />
            )}
            <span className="leading-tight">
              {blockImages 
                ? 'External images have been blocked to protect your privacy.' 
                : 'External images loaded. Your IP/metrics may be visible to the sender.'}
            </span>
          </div>
          <button
            onClick={() => setBlockImages(!blockImages)}
            className={`px-3 py-1 rounded-md text-[10.5px] font-bold shadow-sm transition-all cursor-pointer ${
              blockImages 
                ? 'bg-white hover:bg-slate-100 text-slate-800 border border-slate-300' 
                : 'bg-amber-100 hover:bg-amber-200/80 text-amber-900 border border-amber-300/60'
            }`}
          >
            {blockImages ? 'Show Images' : 'Block Images'}
          </button>
        </div>
      )}

      {/* Isolated Rendering sandbox iframe */}
      <div className="p-4 bg-white">
        <iframe
          ref={iframeRef}
          srcDoc={docHtml}
          title="Sanitized Rich Email Body Sandbox"
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          className="w-full border-0 transition-all duration-150"
          style={{ height: `${iframeHeight}px` }}
          onLoad={handleIframeLoad}
        />
      </div>
    </div>
  );
}
