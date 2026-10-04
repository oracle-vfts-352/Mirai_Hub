import React, { useState } from 'react';

interface CreateCampaignModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (campaignData: any) => void;
}

export const CreateCampaignModal: React.FC<CreateCampaignModalProps> = ({ isOpen, onClose, onSubmit }) => {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<'email' | 'in-app-popup' | 'social-post'>('email');
  const [bodyText, setBodyText] = useState('');
  const [tags, setTags] = useState('');

  if (!isOpen) return null;

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const tagArray = tags.split(',').map(tag => tag.trim()).filter(tag => tag !== '');
    onSubmit({ title, type, bodyText, targetingTags: tagArray });
    // Reset form fields
    setTitle('');
    setBodyText('');
    setTags('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-xl transition-all">
        
        {/* Modal Header */}
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-50">Draft New Campaign</h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-sm">✕</button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleFormSubmit} className="space-y-4 text-sm text-zinc-800 dark:text-zinc-200">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">Campaign Title</label>
            <input 
              type="text" required value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Black Friday Flash Sale"
              className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:outline-none focus:border-mirai-accentLight dark:focus:border-mirai-accentDark transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">Channel Type</label>
            <select 
              value={type} onChange={(e) => setType(e.target.value as any)}
              className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:outline-none focus:border-mirai-accentLight dark:focus:border-mirai-accentDark transition-colors"
            >
              <option value="email">📧 Email Newsletter</option>
              <option value="in-app-popup">📱 In-App Notification</option>
              <option value="social-post">🌐 Public Social Media Post</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">Campaign Content / Media Text</label>
            <textarea 
              rows={4} required value={bodyText} onChange={(e) => setBodyText(e.target.value)}
              placeholder="Write your promotional description here..."
              className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:outline-none focus:border-mirai-accentLight dark:focus:border-mirai-accentDark transition-colors resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">Target Segments (Comma-Separated)</label>
            <input 
              type="text" value={tags} onChange={(e) => setTags(e.target.value)}
              placeholder="premium, beta-testers, inactive-users"
              className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:outline-none focus:border-mirai-accentLight dark:focus:border-mirai-accentDark transition-colors"
            />
          </div>

          {/* Action Control Panel */}
          <div className="flex justify-end gap-3 pt-4 border-t border-zinc-100 dark:border-zinc-900 mt-6">
            <button 
              type="button" onClick={onClose}
              className="px-4 py-2 text-xs font-semibold rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-all"
            >
              Cancel
            </button>
            <button 
              type="submit"
              className="px-4 py-2 bg-mirai-accentLight dark:bg-mirai-accentDark text-white text-xs font-semibold rounded-lg hover:opacity-90 transition-opacity shadow-sm"
            >
              Deploy Campaign
            </button>
          </div>
        </form>

      </div>
    </div>
  );
};