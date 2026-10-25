import React, { useState, useEffect, useRef, KeyboardEvent, ChangeEvent } from 'react';
import { Sparkles, Terminal, BookOpen, Layers } from 'lucide-react';

export interface Snippet {
  trigger: string;
  text: string;
  description?: string;
}

interface SnippetTextAreaProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  snippets: Snippet[];
  className?: string;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
}

// TRIE IMPLEMENTATION FOR LINEAR-TIME SUGGESTION LOOKUPS
class TrieNode {
  children: { [key: string]: TrieNode } = {};
  isWord: boolean = false;
  snippet: Snippet | null = null;
}

class SnippetTrie {
  root: TrieNode = new TrieNode();

  insert(snippet: Snippet) {
    let node = this.root;
    const trigger = snippet.trigger.toLowerCase();
    for (const char of trigger) {
      if (!node.children[char]) {
        node.children[char] = new TrieNode();
      }
      node = node.children[char];
    }
    node.isWord = true;
    node.snippet = snippet;
  }

  // Searches prefix and returns all matching snippets
  searchPrefix(prefix: string): Snippet[] {
    let node = this.root;
    const cleanPrefix = prefix.toLowerCase();
    for (const char of cleanPrefix) {
      if (!node.children[char]) {
        return [];
      }
      node = node.children[char];
    }
    
    // DFS to collect all snippets under this subtree
    const results: Snippet[] = [];
    const collect = (curr: TrieNode) => {
      if (curr.isWord && curr.snippet) {
        results.push(curr.snippet);
      }
      for (const key of Object.keys(curr.children)) {
        collect(curr.children[key]);
      }
    };
    collect(node);
    return results;
  }
}

export default function SnippetTextArea({
  value,
  onChange,
  placeholder = "Type message...",
  snippets,
  className = "",
  onKeyDown
}: SnippetTextAreaProps) {
  const [suggestions, setSuggestions] = useState<Snippet[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [showSuggestions, setShowSuggestions] = useState<boolean>(false);
  const [activePlaceholderRanges, setActivePlaceholderRanges] = useState<{ start: number; end: number }[]>([]);
  const [currentPlaceholderIdx, setCurrentPlaceholderIdx] = useState<number>(-1);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const trieRef = useRef<SnippetTrie>(new SnippetTrie());

  // Re-build Trie whenever snippets list changes
  useEffect(() => {
    const trie = new SnippetTrie();
    for (const snippet of snippets) {
      trie.insert(snippet);
    }
    trieRef.current = trie;
  }, [snippets]);

  // Scans the current text for any remaining placeholders like [Name], [Plan]
  // This is used for Tab cycle selection
  const scanPlaceholders = (text: string) => {
    const regex = /\[([^\]]+)\]/g;
    const ranges: { start: number; end: number }[] = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      ranges.push({
        start: match.index,
        end: match.index + match[0].length
      });
    }
    return ranges;
  };

  // Helper to trigger select highlight of a bracketed placeholder in textarea
  const selectRangeInTextarea = (start: number, end: number) => {
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(start, end);
      }
    }, 10);
  };

  // Handles checking trigger on space, enter or manual trigger
  const checkAndExpandTrigger = (text: string, caretPos: number): boolean => {
    // Look at text before caret. Get the last word.
    const textBeforeCaret = text.substring(0, caretPos);
    const words = textBeforeCaret.split(/(\s+)/);
    const lastWordIndex = words.length - 1;
    const lastWord = words[lastWordIndex];

    if (lastWord && lastWord.startsWith('/')) {
      const matchSnippet = snippets.find(s => s.trigger.toLowerCase() === lastWord.toLowerCase());
      if (matchSnippet) {
        // Expand snippet
        const textAfterCaret = text.substring(caretPos);
        const replacement = matchSnippet.text;
        
        // Remove trigger word
        words[lastWordIndex] = replacement;
        const newTextBeforeCaret = words.join('');
        const newText = newTextBeforeCaret + textAfterCaret;
        
        onChange(newText);

        // Scan for new placeholders in the updated text
        const ranges = scanPlaceholders(newText);
        
        // Find if any of the new placeholders fall inside our newly expanded snippet
        const startOfSnippet = newTextBeforeCaret.length - replacement.length;
        const newPlaceholder = ranges.find(r => r.start >= startOfSnippet && r.end <= newTextBeforeCaret.length);

        if (newPlaceholder) {
          setActivePlaceholderRanges(ranges);
          const idx = ranges.indexOf(newPlaceholder);
          setCurrentPlaceholderIdx(idx);
          selectRangeInTextarea(newPlaceholder.start, newPlaceholder.end);
        } else if (ranges.length > 0) {
          setActivePlaceholderRanges(ranges);
          setCurrentPlaceholderIdx(0);
          selectRangeInTextarea(ranges[0].start, ranges[0].end);
        } else {
          setActivePlaceholderRanges([]);
          setCurrentPlaceholderIdx(-1);
          // Put cursor at end of replacement
          setTimeout(() => {
            if (textareaRef.current) {
              textareaRef.current.focus();
              textareaRef.current.setSelectionRange(newTextBeforeCaret.length, newTextBeforeCaret.length);
            }
          }, 10);
        }

        setShowSuggestions(false);
        return true;
      }
    }
    return false;
  };

  // Handles change events (typing)
  const handleTextChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    onChange(text);

    // If typing, let's look at the word the user is currently typing to show floating suggestions
    const caretPos = e.target.selectionStart;
    const textBeforeCaret = text.substring(0, caretPos);
    const lastWord = textBeforeCaret.split(/\s+/).pop() || '';

    if (lastWord.startsWith('/')) {
      const matched = trieRef.current.searchPrefix(lastWord);
      if (matched.length > 0) {
        setSuggestions(matched);
        setSelectedIndex(0);
        setShowSuggestions(true);
      } else {
        setShowSuggestions(false);
      }
    } else {
      setShowSuggestions(false);
    }

    // Refresh active placeholders if text changed
    const currentRanges = scanPlaceholders(text);
    setActivePlaceholderRanges(currentRanges);
  };

  // Autocomplete snippet from suggestion list
  const applySuggestion = (snippet: Snippet) => {
    if (!textareaRef.current) return;
    const text = value;
    const caretPos = textareaRef.current.selectionStart;
    const textBeforeCaret = text.substring(0, caretPos);
    const words = textBeforeCaret.split(/(\s+)/);
    const lastWordIndex = words.length - 1;

    // Replace trigger word
    words[lastWordIndex] = snippet.text;
    const newTextBeforeCaret = words.join('');
    const textAfterCaret = text.substring(caretPos);
    const newText = newTextBeforeCaret + textAfterCaret;

    onChange(newText);

    const ranges = scanPlaceholders(newText);
    const startOfSnippet = newTextBeforeCaret.length - snippet.text.length;
    const newPlaceholder = ranges.find(r => r.start >= startOfSnippet && r.end <= newTextBeforeCaret.length);

    if (newPlaceholder) {
      setActivePlaceholderRanges(ranges);
      const idx = ranges.indexOf(newPlaceholder);
      setCurrentPlaceholderIdx(idx);
      selectRangeInTextarea(newPlaceholder.start, newPlaceholder.end);
    } else if (ranges.length > 0) {
      setActivePlaceholderRanges(ranges);
      setCurrentPlaceholderIdx(0);
      selectRangeInTextarea(ranges[0].start, ranges[0].end);
    } else {
      setActivePlaceholderRanges([]);
      setCurrentPlaceholderIdx(-1);
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(newTextBeforeCaret.length, newTextBeforeCaret.length);
        }
      }, 10);
    }

    setShowSuggestions(false);
  };

  // Keyboard navigation & controls
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const caretPos = e.currentTarget.selectionStart;

    // 1. SUGGESTIONS LIST KEYBOARD HANDLERS
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        applySuggestion(suggestions[selectedIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowSuggestions(false);
        return;
      }
    }

    // 2. TRIGGER EXPANSION ON SPACE OR ENTER
    if (e.key === ' ' || e.key === 'Enter') {
      const isExpanded = checkAndExpandTrigger(value, caretPos);
      if (isExpanded) {
        e.preventDefault();
        return;
      }
    }

    // 3. TAB KEY CYCLE PLACEHOLDERS
    if (e.key === 'Tab' && !showSuggestions) {
      const latestRanges = scanPlaceholders(value);
      if (latestRanges.length > 0) {
        e.preventDefault();
        
        let nextIdx = 0;
        if (e.shiftKey) {
          // Backward cycle
          nextIdx = currentPlaceholderIdx <= 0 ? latestRanges.length - 1 : currentPlaceholderIdx - 1;
        } else {
          // Forward cycle
          nextIdx = (currentPlaceholderIdx + 1) % latestRanges.length;
        }

        const nextRange = latestRanges[nextIdx];
        if (nextRange) {
          setActivePlaceholderRanges(latestRanges);
          setCurrentPlaceholderIdx(nextIdx);
          selectRangeInTextarea(nextRange.start, nextRange.end);
        }
        return;
      }
    }

    // Pass custom keys to external onKeyDown handler
    if (onKeyDown) {
      onKeyDown(e);
    }
  };

  return (
    <div className="relative w-full flex flex-col">
      {/* Suggestions Autocomplete Box */}
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute bottom-full mb-2 left-0 w-80 max-h-48 overflow-y-auto bg-neutral-900/95 backdrop-blur-md border border-blue-500/30 rounded-xl shadow-[0_4px_24px_rgba(59,130,246,0.15)] z-50 flex flex-col p-1.5 scrollbar-thin">
          <div className="px-2 py-1 border-b border-white/5 flex items-center justify-between">
            <span className="text-[10px] text-blue-400 font-extrabold uppercase tracking-widest flex items-center gap-1">
              <Terminal className="h-3 w-3 animate-pulse" />
              Snippet Engine Match
            </span>
            <span className="text-[9px] text-neutral-500 font-medium">↑↓ to select • Enter to insert</span>
          </div>
          {suggestions.map((snippet, idx) => (
            <button
              key={snippet.trigger}
              onClick={() => applySuggestion(snippet)}
              className={`w-full flex flex-col items-start p-2 rounded-lg text-left transition-all duration-150 ${
                idx === selectedIndex
                  ? 'bg-blue-600/15 border-l-2 border-blue-500 text-white'
                  : 'text-neutral-300 hover:bg-neutral-800/40 border-l-2 border-transparent'
              }`}
            >
              <div className="flex items-center justify-between w-full">
                <span className="text-xs font-mono font-bold text-blue-400">{snippet.trigger}</span>
                {snippet.description && (
                  <span className="text-[9px] text-neutral-500 font-medium">{snippet.description}</span>
                )}
              </div>
              <p className="text-[10px] text-neutral-400 line-clamp-1 mt-0.5 font-sans italic">{snippet.text}</p>
            </button>
          ))}
        </div>
      )}

      {/* Main Textarea Container */}
      <div className="relative flex-1 w-full flex">
        <textarea
          id="composer-textarea"
          ref={textareaRef}
          value={value}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={3}
          className={`flex-1 min-h-[72px] max-h-[200px] w-full rounded-xl border p-2.5 text-xs font-semibold text-white placeholder-neutral-500 outline-none transition-all scrollbar-thin resize-none ${className}`}
        />

        {/* Small Engine Status Indicator inside the input container */}
        <div className="absolute right-2 bottom-2 flex items-center gap-1.5 pointer-events-none select-none">
          {activePlaceholderRanges.length > 0 && (
            <span className="text-[9px] text-orange-400 font-mono bg-orange-500/10 border border-orange-500/20 px-1.5 py-0.5 rounded flex items-center gap-1">
              <Layers className="h-2.5 w-2.5 animate-bounce" />
              {currentPlaceholderIdx + 1}/{activePlaceholderRanges.length} placeholder
            </span>
          )}
          <span className="text-[9px] text-blue-400 font-mono bg-blue-500/10 border border-blue-500/20 px-1.5 py-0.5 rounded flex items-center gap-1">
            <Sparkles className="h-2.5 w-2.5 text-blue-400" />
            Snippet AI Active
          </span>
        </div>
      </div>
    </div>
  );
}
