'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api-client';

/**
 * Hook to get the default branch ID for single restaurant system
 * Fetches the branch ID once and caches it in localStorage
 */
export function useBranchId(): string | null {
  const [branchId, setBranchId] = useState<string | null>(() => {
    // Try to load from localStorage first
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('defaultBranchId');
  });

  useEffect(() => {
    const fetchBranchId = async () => {
      try {
        const branch = await apiClient.restaurant.getDefaultBranch();
        if (branch?.id) {
          setBranchId(branch.id);
          localStorage.setItem('defaultBranchId', branch.id);
          localStorage.setItem('defaultRestaurantId', branch.restaurantId);
        }
      } catch (error) {
        console.error('Failed to fetch branch ID:', error);
      }
    };

    if (!branchId) {
      fetchBranchId();
    }
  }, [branchId]);

  return branchId;
}

/**
 * Hook to get the default restaurant ID for single restaurant system
 * Fetches the restaurant ID once and caches it in localStorage
 */
export function useRestaurantId(): string | null {
  const [restaurantId, setRestaurantId] = useState<string | null>(() => {
    // Try to load from localStorage first
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('defaultRestaurantId');
  });

  useEffect(() => {
    const fetchRestaurantId = async () => {
      try {
        const branch = await apiClient.restaurant.getDefaultBranch();
        if (branch?.restaurantId) {
          setRestaurantId(branch.restaurantId);
          localStorage.setItem('defaultRestaurantId', branch.restaurantId);
          localStorage.setItem('defaultBranchId', branch.id);
        }
      } catch (error) {
        console.error('Failed to fetch restaurant ID:', error);
      }
    };

    if (!restaurantId) {
      fetchRestaurantId();
    }
  }, [restaurantId]);

  return restaurantId;
}
