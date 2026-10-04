import { CampaignMetric } from '../types/ui';

const API_BASE_URL = 'https://miraihub.cloud'; // This points to your Nginx proxy domain

export const apiClient = {
  // Fetch campaigns strictly scoped to the authorized tenant token
  async fetchCampaigns(authToken: string): Promise<CampaignMetric[]> {
    const response = await fetch(`${API_BASE_URL}/api/campaigns`, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      }
    });
    if (!response.ok) throw new Error('Network error during multi-tenant fetch');
    return response.json();
  },

  // Post a new campaign with strong structure layout requirements
  async createCampaign(authToken: string, data: Omit<CampaignMetric, 'id' | 'reachCount' | 'engagementRate'>): Promise<CampaignMetric> {
    const response = await fetch(`${API_BASE_URL}/api/campaigns`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Authorization fail or validation crash at server engine');
    return response.json();
  }
};