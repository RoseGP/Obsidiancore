/** In-meeting chat: everyone or a private message, emoji, and file sharing (up to 25 MB). */
import React, { useEffect, useRef, useState } from 'react';
import { FileText, Paperclip, Send, Smile } from 'lucide-react';
import { useMeetingSession } from '../../../context/MeetingSessionContext';
import { useNotify } from './NotificationSystem';

const QUICK_EMOJI = ['👍', '👏', '😄', '🎉', '❤️', '🙏', '💡', '✅'];
const MAX_FILE = 25 * 1024 * 1024;

export function ChatPanel({ recipient, onRecipientChange }: { recipient: string; onRecipientChange: (id: string) => void }) {
  const { activeMeeting, sendChatMessage } = useMeetingSession();
  const notify = useNotify();
  const [text, setText] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messages = activeMeeting?.messages ?? [];
  const people = activeMeeting?.participants ?? [];

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages.length]);

  const send = (e?: React.FormEvent) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t) return;
    sendChatMessage(t, recipient);
    setText('');
    inputRef.current?.focus();
  };

  const attach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_FILE) { notify(`${file.name} is larger than 25 MB. Share a smaller file or a link.`, 'warning'); return; }
    const url = URL.createObjectURL(file);
    const size = file.size >= 1024 * 1024 ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`;
    sendChatMessage(`Shared a file: ${file.name}`, recipient, { name: file.name, size, type: file.type || 'application/octet-stream', url });
    notify(`Shared ${file.name}`, 'success');
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-4 py-2.5" style={{ borderBottom: '1px solid var(--m-line)' }}>
        <label htmlFor="chat-recipient" className="m-muted text-[12.5px]">To</label>
        <select id="chat-recipient" className="m-input" style={{ height: 32, fontSize: 13 }} value={recipient} onChange={(e) => onRecipientChange(e.target.value)}>
          <option value="everyone">Everyone</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name} (private)</option>)}
        </select>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite" aria-label="Chat messages">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <p className="text-[14px] font-semibold">No messages yet</p>
            <p className="m-muted max-w-[240px] text-[13px]">Messages you send here are visible to everyone in the meeting unless you pick one person.</p>
          </div>
        )}
        {messages.map((m) => {
          const isPrivate = m.recipientId && m.recipientId !== 'everyone';
          return (
            <div key={m.id} className={`flex flex-col gap-1 ${m.isYou ? 'items-end' : 'items-start'}`}>
              <div className="m-faint flex items-center gap-1.5 text-[11.5px]">
                <span className="font-semibold" style={{ color: 'var(--m-muted)' }}>{m.isYou ? 'You' : m.senderName}</span>
                <span>{m.timestamp}</span>
                {isPrivate && <span style={{ color: 'var(--m-warn)' }}>· private{m.recipientName ? ` to ${m.recipientName}` : ''}</span>}
              </div>
              <div className="max-w-[88%] rounded-2xl px-3.5 py-2 text-[13.5px] leading-relaxed"
                style={m.isYou ? { background: 'var(--m-accent-strong)', color: 'var(--m-on-accent)', borderTopRightRadius: 6 } : { background: 'var(--m-raised)', borderTopLeftRadius: 6 }}>
                <p className="whitespace-pre-wrap break-words">{m.text}</p>
                {m.attachments?.map((a) => (
                  <a key={a.name} href={a.url && a.url !== '#' ? a.url : undefined} target="_blank" rel="noreferrer" download={a.name}
                    className="mt-2 flex items-center gap-2 rounded-xl px-2.5 py-2"
                    style={{ background: m.isYou ? 'rgba(255,255,255,.14)' : 'var(--m-solid)', color: 'inherit', textDecoration: 'none' }}>
                    <FileText size={16} aria-hidden />
                    <span className="min-w-0 flex-1"><span className="block truncate text-[12.5px] font-semibold">{a.name}</span><span className="block text-[11.5px] opacity-75">{a.size}</span></span>
                  </a>
                ))}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {emojiOpen && (
        <div className="flex flex-wrap gap-1 px-3 pb-2">
          {QUICK_EMOJI.map((e) => (
            <button key={e} type="button" className="m-reaction" style={{ width: 34, height: 34, fontSize: 17 }} aria-label={`Insert ${e}`}
              onClick={() => { setText((t) => t + e); setEmojiOpen(false); inputRef.current?.focus(); }}>{e}</button>
          ))}
        </div>
      )}
      <form onSubmit={send} className="flex items-end gap-1.5 px-3 pb-3 pt-2" style={{ borderTop: '1px solid var(--m-line)' }}>
        <label className="m-icon-btn" title="Share a file (up to 25 MB)" aria-label="Share a file">
          <Paperclip size={18} />
          <input type="file" className="sr-only" onChange={attach} />
        </label>
        <button type="button" className="m-icon-btn" aria-label="Insert emoji" aria-expanded={emojiOpen} onClick={() => setEmojiOpen((o) => !o)}><Smile size={18} /></button>
        <textarea id="chat-input" ref={inputRef} rows={1} className="m-input min-w-0 flex-1" style={{ minHeight: 38, maxHeight: 120 }}
          placeholder={recipient === 'everyone' ? 'Message everyone' : 'Private message'} value={text} aria-label="Message"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button type="submit" className="m-btn m-btn-primary" style={{ width: 38, padding: 0 }} disabled={!text.trim()} aria-label="Send message"><Send size={16} /></button>
      </form>
    </div>
  );
}
