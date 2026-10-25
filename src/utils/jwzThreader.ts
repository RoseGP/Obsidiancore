import { ThreadableEmail } from '../types';

/**
 * Visual / relational node representing a position in the email conversation thread tree.
 */
export interface JWZNode {
  id: string;                 // The database ID or a generated placeholder ID
  messageId: string;          // The standard Message-ID header (e.g. "<xyz@domain.com>")
  email: ThreadableEmail | null; // The actual email entity, or null if it's a ghost/placeholder node
  parent: JWZNode | null;     // Pointer to parent node
  children: JWZNode[];        // Ordered list of child nodes
}

/**
 * Normalized representation of the JWZ thread tree output for API response.
 */
export interface JWZThreadTree {
  id: string;
  messageId: string;
  subject: string;
  date: string | null;
  isPlaceholder: boolean;
  emailDetails?: Partial<ThreadableEmail> | null;
  children: JWZThreadTree[];
}

/**
 * Database update operation returned to allow flat updates of derived thread IDs.
 */
export interface ThreadUpdateOperation {
  emailId: string;
  derivedThreadId: string;
}

/**
 * Strips common email subject prefixes like 'Re:', 'Fwd:', brackets, and whitespace,
 * returning a clean normalized subject.
 */
export function normalizeSubject(subject: string): string {
  if (!subject) return '';
  // Convert to lowercase and strip typical prefixes repeatedly
  let normalized = subject.toLowerCase().trim();
  
  const prefixRegex = /^(re|fwd|fw|aw|antw|wg|reply|forward|loop|alert)\s*:\s*/i;
  let matches = true;
  while (matches) {
    const before = normalized;
    normalized = normalized.replace(prefixRegex, '').trim();
    if (normalized === before) {
      matches = false;
    }
  }
  
  // Clean up any extra internal whitespaces
  return normalized.replace(/\s+/g, ' ');
}

/**
 * Checks if two dates are within a specified number of days (default 7 days).
 */
export function isWithinTimeThreshold(dateA: Date | string, dateB: Date | string, maxDays = 7): boolean {
  try {
    const timeA = new Date(dateA).getTime();
    const timeB = new Date(dateB).getTime();
    if (isNaN(timeA) || isNaN(timeB)) return false;
    const diffMs = Math.abs(timeA - timeB);
    const maxMs = maxDays * 24 * 60 * 60 * 1000;
    return diffMs <= maxMs;
  } catch {
    return false;
  }
}

/**
 * Formats a single node and its descendants into a clean nested JSON tree representation.
 */
export function formatNodeToTree(node: JWZNode): JWZThreadTree {
  // Sort children by date to keep the tree temporally chronological
  const sortedChildren = [...node.children].sort((a, b) => {
    const dateA = a.email ? new Date(a.email.date).getTime() : 0;
    const dateB = b.email ? new Date(b.email.date).getTime() : 0;
    return dateA - dateB;
  });

  return {
    id: node.id,
    messageId: node.messageId,
    subject: node.email ? node.email.subject : '(No Subject / Placeholder)',
    date: node.email ? new Date(node.email.date).toISOString() : null,
    isPlaceholder: node.email === null,
    emailDetails: node.email ? {
      id: node.email.id,
      subject: node.email.subject,
      date: node.email.date,
      inReplyTo: node.email.inReplyTo,
      references: node.email.references,
    } : null,
    children: sortedChildren.map(child => formatNodeToTree(child)),
  };
}

/**
 * Advanced, memory-efficient email threading engine implementing Jamie Zawinski's (JWZ)
 * message threading algorithm with full support for placeholder creation, loop detection,
 * subject normalization fallback, and temporal thresholding.
 */
export class JWZThreader {
  private idTable: Map<string, JWZNode> = new Map();

  /**
   * Main entry point: Threads an array of emails and returns both a nested tree
   * and flat DB update operations to store the sync state.
   */
  public threadEmails(emails: ThreadableEmail[]): {
    trees: JWZThreadTree[];
    updates: ThreadUpdateOperation[];
  } {
    this.idTable.clear();

    console.log(`[JWZ Threader] Initializing threading process for ${emails.length} emails...`);

    // --- PHASE 1: Populate idTable and instantiate nodes ---
    for (const email of emails) {
      if (!email.messageId) continue;
      
      const msgId = email.messageId.trim();
      let node = this.idTable.get(msgId);
      
      if (!node) {
        node = {
          id: email.id,
          messageId: msgId,
          email: email,
          parent: null,
          children: []
        };
        this.idTable.set(msgId, node);
      } else {
        // If a ghost/placeholder was already created, attach the real email entity to it
        node.email = email;
        node.id = email.id; // upgrade generated ghost ID to actual DB ID
      }
    }

    // --- PHASE 2: Map parent-child references ---
    for (const email of emails) {
      if (!email.messageId) continue;
      
      const emailNode = this.idTable.get(email.messageId.trim())!;
      const refs = email.references || [];
      const inReplyTo = email.inReplyTo;
      
      // Combine all references and inReplyTo to form the message ancestry line
      const ancestry: string[] = [];
      const seenRefs = new Set<string>();

      for (const r of refs) {
        const cleanRef = r.trim();
        if (cleanRef && !seenRefs.has(cleanRef)) {
          ancestry.push(cleanRef);
          seenRefs.add(cleanRef);
        }
      }

      if (inReplyTo) {
        const cleanReplyTo = inReplyTo.trim();
        if (cleanReplyTo && !seenRefs.has(cleanReplyTo)) {
          ancestry.push(cleanReplyTo);
        }
      }

      let prevNode: JWZNode | null = null;

      // Link references in sequence: reference[0] -> reference[1] -> ... -> emailNode
      for (const refId of ancestry) {
        let refNode = this.idTable.get(refId);
        if (!refNode) {
          // Create placeholder/ghost node for out-of-order parent emails
          refNode = {
            id: `ghost-${Math.random().toString(36).substr(2, 9)}`,
            messageId: refId,
            email: null,
            parent: null,
            children: []
          };
          this.idTable.set(refId, refNode);
        }

        if (prevNode && prevNode !== refNode) {
          // Link prevNode as parent of refNode if refNode does not already have a parent,
          // checking strictly for cycle creation.
          if (!refNode.parent && !this.isDescendantOf(prevNode, refNode)) {
            refNode.parent = prevNode;
            if (!prevNode.children.includes(refNode)) {
              prevNode.children.push(refNode);
            }
          }
        }
        prevNode = refNode;
      }

      // Finally, link emailNode to the last ancestor node
      if (prevNode && prevNode !== emailNode) {
        if (!emailNode.parent && !this.isDescendantOf(prevNode, emailNode)) {
          emailNode.parent = prevNode;
          if (!prevNode.children.includes(emailNode)) {
            prevNode.children.push(emailNode);
          }
        }
      }
    }

    // --- PHASE 3: Gather Root Nodes ---
    let rootNodes: JWZNode[] = [];
    for (const [_, node] of this.idTable.entries()) {
      if (!node.parent) {
        rootNodes.push(node);
      }
    }

    // --- PHASE 4: Prune Ghost/Placeholder Root Nodes ---
    // A ghost root node is a node with email === null and parent === null.
    // We want to remove them and promote their children to be roots.
    let prunedRoots: JWZNode[] = [];
    for (const root of rootNodes) {
      if (root.email === null) {
        // Promote all of its children to root status
        for (const child of root.children) {
          child.parent = null;
          prunedRoots.push(child);
        }
      } else {
        prunedRoots.push(root);
      }
    }
    rootNodes = prunedRoots;

    // --- PHASE 5: Subject-Based Fallback Grouping ---
    // For emails without headers (inReplyTo/references) or roots that are logically part of a conversation,
    // we match them based on subject line normalization and a 7-day temporal window constraint.
    const subjectMap: Map<string, JWZNode[]> = new Map();

    for (const root of rootNodes) {
      if (!root.email) continue;
      const normalizedSubj = normalizeSubject(root.email.subject);
      if (!normalizedSubj) continue;

      let list = subjectMap.get(normalizedSubj);
      if (!list) {
        list = [];
        subjectMap.set(normalizedSubj, list);
      }
      list.push(root);
    }

    // Attempt to merge matching root nodes
    const mergedRootIds = new Set<string>();

    for (const [_, roots] of subjectMap.entries()) {
      if (roots.length <= 1) continue;

      // Sort roots chronologically to link the newer root as child of older root
      roots.sort((a, b) => {
        const timeA = a.email ? new Date(a.email.date).getTime() : 0;
        const timeB = b.email ? new Date(b.email.date).getTime() : 0;
        return timeA - timeB;
      });

      for (let i = 0; i < roots.length; i++) {
        const baseRoot = roots[i];
        if (mergedRootIds.has(baseRoot.id)) continue;

        for (let j = i + 1; j < roots.length; j++) {
          const targetRoot = roots[j];
          if (mergedRootIds.has(targetRoot.id)) continue;

          // Verify if they fit the 7-day threshold limit
          if (
            baseRoot.email && 
            targetRoot.email && 
            isWithinTimeThreshold(baseRoot.email.date, targetRoot.email.date, 7)
          ) {
            // Check loop prevention
            if (!this.isDescendantOf(baseRoot, targetRoot)) {
              // targetRoot (newer) becomes child of baseRoot (older)
              targetRoot.parent = baseRoot;
              if (!baseRoot.children.includes(targetRoot)) {
                baseRoot.children.push(targetRoot);
              }
              mergedRootIds.add(targetRoot.id);
            }
          }
        }
      }
    }

    // Re-filter root nodes after subject-based matching
    const finalRootNodes = rootNodes.filter(node => !node.parent);

    // --- PHASE 6: Assign Thread IDs & Generate Update Operations ---
    const updates: ThreadUpdateOperation[] = [];

    // Assign threadId derived from the root node's ID to every member of the thread tree
    for (const root of finalRootNodes) {
      // Use root email ID, or fallback to the root's placeholder ID
      const derivedThreadId = root.email ? root.email.id : root.id;
      this.assignThreadIdRecursive(root, derivedThreadId, updates);
    }

    // Format final roots to visual relational tree output
    const trees = finalRootNodes.map(root => formatNodeToTree(root));

    console.log(`[JWZ Threader] Successfully resolved into ${trees.length} conversation thread(s).`);

    return {
      trees,
      updates
    };
  }

  /**
   * Helper function: Deep-assigns a derived thread ID down the tree hierarchy and collects DB updates.
   */
  private assignThreadIdRecursive(node: JWZNode, threadId: string, updates: ThreadUpdateOperation[]): void {
    if (node.email) {
      node.email.derivedThreadId = threadId;
      updates.push({
        emailId: node.email.id,
        derivedThreadId: threadId
      });
    }
    for (const child of node.children) {
      this.assignThreadIdRecursive(child, threadId, updates);
    }
  }

  /**
   * Loop Prevention check: Returns true if `potentialDescendant` is a descendant of `potentialAncestor`.
   */
  private isDescendantOf(potentialAncestor: JWZNode, potentialDescendant: JWZNode): boolean {
    if (!potentialAncestor || !potentialDescendant) return false;
    if (potentialAncestor === potentialDescendant) return true;
    
    let current = potentialDescendant.parent;
    const visited = new Set<string>(); // avoid absolute infinity loops in pre-existing corrupt data
    
    while (current) {
      if (current === potentialAncestor) return true;
      if (visited.has(current.messageId)) break;
      
      visited.add(current.messageId);
      current = current.parent;
    }
    return false;
  }
}
