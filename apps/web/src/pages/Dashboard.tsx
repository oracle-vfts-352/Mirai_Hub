import React, { useState, useEffect } from 'react';
import { CampaignMetric, DashboardState } from '../types/ui';
import { SkeletonCard } from '../components/SkeletonCard';
import { CreateCampaignModal } from '../components/CreateCampaignModal';

export const Dashboard: React.FC = () => {
  // Theme state control
  const [darkMode, setDarkMode] = useState<boolean>(true);
  
  // Modal overlay visibility toggle
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  
  // Mock Token representing a cryptographically signed JWT from user login
  // This token handles multi-tenant verification via Nginx/API layers
  const [authToken] = useState<string>("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.mirai-hub-mock-token");

  // Core UI Data State Matrix
  const [state, setState] = useState<DashboardState>({
    isLoading: true,
    campaigns: [],
    companyName: "NexusCorp Media" // Assigned company tenant identity
  });

  // Mock initial database read to simulate Nginx proxy and network execution delays
  useEffect(() => {
    const fetchTimer = setTimeout(() => {
      const mockDatabaseRows: CampaignMetric[] = [
        { id: '1', title: 'Q4 Product Launch Announcement', type: 'email', status: 'published', reachCount: 14200, engagementRate: 24.5 },
        { id: '2', title: 'Black Friday Flash Promotion', type: 'in-app-popup', status: 'queued', reachCount: 0, engagementRate: 0 },
        { id: '3', title: 'Privacy Architecture Deep-dive', type: 'social-post', status: 'draft', reachCount: 540, engagementRate: 12.1 }
      ];
      setState(prev => ({ ...prev, isLoading: false, campaigns: mockDatabaseRows }));
    }, 2000); // 2-second sleep duration to render clean skeleton states safely

    return () => clearTimeout(fetchTimer);
  }, []);

  // Intercepts campaign creation submissions and handles mutations safely
  const handleNewCampaignSubmit = (newCampaignData: { title: string; type: 'email' | 'in-app-popup' | 'social-post'; bodyText: string; targetingTags: string[] }) => {
    // Generate an aligned object containing strong typings mapped to your Prisma entity configuration
    const newlyCreatedRow: CampaignMetric = {
      id: (state.campaigns.length + 1).toString(), // Increments ID safely
      title: newCampaignData.title,
      type: newCampaignData.type,
      status: 'draft', // New custom user workflows deploy directly to draft storage allocations
      reachCount: 0,
      engagementRate: 0
    };

    // Prepend new campaigns cleanly to the dashboard data state matrix
    setState(prev => ({
      ...prev,
      campaigns: [newlyCreatedRow, ...prev.campaigns]
    }));
  };

  return (
    <div className={`${darkMode ? 'dark' : ''} min-h-screen w-full transition-colors duration-300`}>
      <div className="bg-mirai-bgLight dark:bg-mirai-bgDark text-mirai-textLight dark:text-mirai-textDark min-h-screen p-8 font-sans transition-colors duration-300">
        
        {/* ==================== TOP NAVIGATION BAR ==================== */}
        <header className="flex justify-between items-center mb-12 border-b border-zinc-100 dark:border-zinc-900 pb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Mirai Hub</h1>
            <p className="text-zinc-500 text-sm mt-1">
              Tenant Space: <span className="font-semibold text-zinc-700 dark:text-zinc-300">{state.companyName}</span>
            </p>
          </div>
          
          <div className="flex items-center gap-4">
            {/* Dynamic Light/Dark Modifier Controller */}
            <button 
              onClick={() => setDarkMode(!darkMode)}
              className="px-4 py-2 text-xs font-semibold rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-all shadow-sm bg-white dark:bg-zinc-950"
            >
              Toggle {darkMode ? '☀️ Light' : '🌙 Dark'} Mode
            </button>
            
            {/* Tenant Status Visual Anchor */}
            <div className="h-8 w-8 rounded-full bg-mirai-accentLight dark:bg-mirai-accentDark flex items-center justify-center text-white text-xs font-bold shadow-md">
              N
            </div>
          </div>
        </header>

        {/* ==================== CONTROL & ACTION PANEL ==================== */}
        <div className="mb-8 flex justify-between items-center">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Active Marketing Operations</h2>
            <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">Manage communication outreach, user metrics, and channels.</p>
          </div>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="bg-mirai-accentLight dark:bg-mirai-accentDark hover:opacity-90 transition-all text-white text-sm font-medium px-4 py-2 rounded-lg shadow-md active:scale-95"
          >
            + Create Campaign
          </button>
        </div>

        {/* ==================== CORE DATA DISPLAY GRID ==================== */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {state.isLoading ? (
            // Render fast-pulsing template placeholder rows if structural query resolution is processing
            <>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : (
            // Safe, authenticated data mapping layer
            state.campaigns.map((campaign) => (
              <div 
                key={campaign.id} 
                className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 bg-white dark:bg-zinc-900/20 hover:border-mirai-accentLight dark:hover:border-mirai-accentDark transition-all duration-200 shadow-sm flex flex-col justify-between group"
              >
                <div>
                  <div className="flex justify-between items-start gap-4 mb-4">
                    <h3 className="font-semibold text-base leading-snug text-zinc-900 dark:text-zinc-100 group-hover:text-mirai-accentLight dark:group-hover:text-mirai-accentDark transition-colors">
                      {campaign.title}
                    </h3>
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full shrink-0 ${
                      campaign.status === 'published' ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400' :
                      campaign.status === 'queued' ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400' :
                      'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                    }`}>
                      {campaign.status}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500 capitalize font-medium">
                    Channel Target: <span className="text-zinc-600 dark:text-zinc-300">{campaign.type}</span>
                  </p>
                </div>

                {/* Performance Analytics Tracking Layer */}
                <div className="mt-6 pt-4 border-t border-zinc-100 dark:border-zinc-900/60 flex justify-between items-center text-xs text-zinc-500 dark:text-zinc-400">
                  <div>Reach: <span className="font-bold text-zinc-800 dark:text-zinc-200">{campaign.reachCount.toLocaleString()}</span></div>
                  <div>Engagement: <span className="font-bold text-mirai-accentLight dark:text-mirai-accentDark">{campaign.engagementRate}%</span></div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* ==================== MODAL OVERLAY INJECTIONS ==================== */}
        <CreateCampaignModal 
          isOpen={isModalOpen} 
          onClose={() => setIsModalOpen(false)} 
          onSubmit={handleNewCampaignSubmit} 
        />

      </div>
    </div>
  );
};
