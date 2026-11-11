import React, { useState } from 'react';
import { 
  Megaphone, Plus, Sparkles, Calendar as CalendarIcon, 
  Clock, Eye, MousePointerClick, Edit3, Trash2,
  CheckCircle2, AlertCircle, Send, ArrowRight
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { PostEditorModal } from './PostEditorModal';
import { EmptyState } from '../ui/EmptyState';
import { PostItem, LocationItem } from '../types';

export interface PostsViewProps {
  posts: PostItem[];
  locations: LocationItem[];
  onSavePost: (post: Partial<PostItem>) => void;
  onOpenAiAssistant: () => void;
}

export const PostsView: React.FC<PostsViewProps> = ({
  posts,
  locations,
  onSavePost,
  onOpenAiAssistant
}) => {
  const [activeTab, setActiveTab] = useState<'All' | 'Drafts' | 'Scheduled' | 'Published'>('All');
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<Partial<PostItem> | null>(null);
  const [viewMode, setViewMode] = useState<'cards' | 'calendar'>('cards');

  const filtered = posts.filter((p) => {
    if (activeTab === 'Drafts') return p.status === 'Draft' || p.status === 'Needs Approval';
    if (activeTab === 'Scheduled') return p.status === 'Scheduled';
    if (activeTab === 'Published') return p.status === 'Published';
    return true;
  });

  const handleCreateNew = () => {
    setEditingPost(null);
    setIsEditorOpen(true);
  };

  const handleEdit = (post: PostItem) => {
    setEditingPost(post);
    setIsEditorOpen(true);
  };

  // Calendar: this week and last week (Mon–Sun), with the posts Google reports for each day.
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) - 7);
  const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const calendarDays = Array.from({ length: 14 }, (_, n) => {
    const d = new Date(monday); d.setDate(monday.getDate() + n);
    return {
      date: d.toLocaleDateString(undefined, { month: 'short', day: '2-digit' }),
      isToday: dayKey(d) === dayKey(today),
      posts: posts.filter((p) => p.createdAt && dayKey(new Date(p.createdAt)) === dayKey(d))
        .map((p) => ({ id: p.id, title: p.title || p.content.slice(0, 40) || p.type })),
    };
  });
  const calendarCount = calendarDays.reduce((a, d) => a + d.posts.length, 0);

  return (
    <div className="space-y-6 animate-in fade-in duration-200" id="localpilot-posts-view">
      
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-1">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Posts
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Publish updates, offers and events to your Google Business Profile.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="primary"
            size="sm"
            onClick={handleCreateNew}
            leftIcon={<Plus className="h-3.5 w-3.5" />}
          >
            Create Post
          </Button>
        </div>
      </div>

      {/* Tabs & View switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-2">
        <div className="flex items-center gap-1 text-xs font-semibold">
          {(['All', 'Drafts', 'Scheduled', 'Published'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                activeTab === tab
                  ? 'bg-slate-100 text-slate-900'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setViewMode('cards')}
            className={`px-2.5 py-1 rounded-md font-medium transition cursor-pointer ${
              viewMode === 'cards' ? 'bg-blue-50 text-blue-600 font-bold' : 'text-slate-500 hover:bg-slate-100'
            }`}
          >
            List view
          </button>
          <button
            type="button"
            onClick={() => setViewMode('calendar')}
            className={`px-2.5 py-1 rounded-md font-medium transition cursor-pointer flex items-center gap-1.5 ${
              viewMode === 'calendar' ? 'bg-blue-50 text-blue-600 font-bold' : 'text-slate-500 hover:bg-slate-100'
            }`}
          >
            <CalendarIcon className="h-3.5 w-3.5" />
            Calendar
          </button>
        </div>
      </div>

      {/* CALENDAR VIEW */}
      {viewMode === 'calendar' && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">
              Last two weeks
            </h3>
            <span className="text-xs text-slate-500">{calendarCount} post{calendarCount === 1 ? '' : 's'} published</span>
          </div>

          <div className="grid grid-cols-7 gap-2 text-xs">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
              <div key={day} className="text-center font-bold text-slate-400 pb-1 uppercase tracking-wider text-[10px]">
                {day}
              </div>
            ))}

            {calendarDays.map((d, i) => (
              <div
                key={i}
                className={`min-h-[90px] p-2 rounded-lg border text-left flex flex-col justify-between ${
                  d.isToday ? 'bg-blue-50/40 border-blue-200' : 'bg-slate-50/50 border-slate-100'
                }`}
              >
                <div className="flex items-center justify-between text-[11px]">
                  <span className={`font-semibold ${d.isToday ? 'text-blue-600' : 'text-slate-700'}`}>
                    {d.date}
                  </span>
                  {d.isToday && (
                    <span className="text-[9px] font-bold bg-blue-600 text-white px-1 rounded">
                      TODAY
                    </span>
                  )}
                </div>

                <div className="space-y-1">
                  {d.posts.map((p) => (
                    <div
                      key={p.id}
                      onClick={() => handleCreateNew()}
                      className="p-1.5 rounded bg-blue-100/90 text-blue-900 border border-blue-200 text-[10px] font-medium truncate cursor-pointer hover:bg-blue-200 transition"
                    >
                      {p.title}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CARDS LIST VIEW */}
      {viewMode === 'cards' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((post) => (
            <div
              key={post.id}
              className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden flex flex-col justify-between hover:border-slate-300 transition-all"
            >
              <div>
                {/* Media preview */}
                {post.imageUrl && (
                  <div className="h-40 w-full overflow-hidden relative bg-slate-100">
                    <img
                      src={post.imageUrl}
                      alt={post.title || 'Post banner'}
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                      <Badge variant="neutral" size="sm" className="bg-black/60 text-white border-0 backdrop-blur-xs">
                        {post.type}
                      </Badge>
                      {post.isAiGenerated && (
                        <Badge variant="info" size="sm" className="bg-blue-600 text-white border-0">
                          AI draft
                        </Badge>
                      )}
                    </div>
                  </div>
                )}

                {/* Body Content */}
                <div className="p-4 space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span>{post.locationName}</span>
                    <Badge
                      variant={
                        post.status === 'Published' ? 'success' :
                        post.status === 'Scheduled' ? 'info' : 'warning'
                      }
                      size="sm"
                    >
                      {post.status}
                    </Badge>
                  </div>

                  {post.title && (
                    <h3 className="font-bold text-xs text-slate-900">
                      {post.title}
                    </h3>
                  )}

                  <p className="text-xs text-slate-900 leading-relaxed line-clamp-3">
                    {post.content}
                  </p>
                </div>
              </div>

              {/* Footer with Performance / Schedule dates and Action buttons */}
              <div className="p-3 px-4 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between text-xs">
                {post.status === 'Published' ? (
                  <div className="flex items-center gap-3 text-[11px] text-slate-500">
                    <span className="flex items-center gap-1">
                      <Eye className="h-3 w-3 text-slate-400" /> {post.viewsCount || 0}
                    </span>
                    <span className="flex items-center gap-1">
                      <MousePointerClick className="h-3 w-3 text-slate-400" /> {post.clicksCount || 0}
                    </span>
                  </div>
                ) : post.status === 'Scheduled' ? (
                  <div className="flex items-center gap-1 text-[11px] text-blue-700 font-medium">
                    <Clock className="h-3 w-3" /> Scheduled for {post.scheduledDate}
                  </div>
                ) : (
                  <span className="text-[11px] text-slate-500">Draft saved</span>
                )}

                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => handleEdit(post)}
                >
                  {post.isAiGenerated && post.status === 'Draft' ? 'Approve & Edit' : 'Edit'}
                </Button>
              </div>

            </div>
          ))}
        </div>
      )}

      {/* Editor Modal */}
      <PostEditorModal
        isOpen={isEditorOpen}
        onClose={() => setIsEditorOpen(false)}
        onSavePost={onSavePost}
        locations={locations}
        initialPost={editingPost}
      />

    </div>
  );
};

export default PostsView;
