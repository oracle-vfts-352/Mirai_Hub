export interface CampaignMetric {
  id: string;
  title: string;
  type: 'email' | 'in-app-popup' | 'social-post';
  status: 'draft' | 'queued' | 'published';
  reachCount: number;
  engagementRate: number;
}

export interface DashboardState {
  isLoading: boolean;
  campaigns: CampaignMetric[];
  companyName: string;
}