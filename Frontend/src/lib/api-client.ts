import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

class ApiClient {
  private client: AxiosInstance;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private refreshing: Promise<string> | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.setupInterceptors();
    this.loadTokensFromStorage();
  }

  private loadTokensFromStorage() {
    if (typeof window === 'undefined') return;
    this.accessToken = localStorage.getItem('accessToken');
    this.refreshToken = localStorage.getItem('refreshToken');
  }

  private setupInterceptors() {
    // Request interceptor
    this.client.interceptors.request.use(
      (config) => {
        // Always reload token from storage before each request
        const token = localStorage.getItem('accessToken');
        if (token) {
          this.accessToken = token;
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;

        // If error is 401 and we haven't retried yet
        const isAuthCall = /\/auth\/(login|register|refresh-token)/.test(originalRequest?.url || '');
        if (error.response?.status === 401 && !originalRequest._retry && !isAuthCall) {
          originalRequest._retry = true;

          try {
            // Reload refresh token from storage
            this.refreshToken = localStorage.getItem('refreshToken');
            
            if (!this.refreshToken) {
              throw new Error('No refresh token available');
            }

            // Single-flight: refresh tokens rotate (one use), so parallel 401s must share one refresh
            if (!this.refreshing) {
              this.refreshing = this.refreshAccessToken()
                .then((response) => {
                  // Backend wraps response in data.data structure
                  const body = response.data.data || response.data;
                  if (!body?.accessToken) throw new Error('No access token in refresh response');
                  this.setAccessToken(body.accessToken);
                  // the server rotates the refresh token: always keep the newest one
                  if (body.refreshToken) this.setRefreshToken(body.refreshToken);
                  return body.accessToken as string;
                })
                .finally(() => {
                  this.refreshing = null;
                });
            }
            const newAccessToken = await this.refreshing;

            // Retry original request with new token
            originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
            return this.client(originalRequest);
          } catch (refreshError) {
            // Refresh failed, logout user
            console.error('Token refresh failed:', refreshError);
            this.clearTokens();
            // public pages (QR ordering) and the login page must not bounce
            const path = window.location.pathname;
            if (path !== '/auth' && !path.startsWith('/order')) window.location.href = '/auth';
            return Promise.reject(refreshError);
          }
        }

        return Promise.reject(error);
      }
    );
  }

  setAccessToken(token: string) {
    this.accessToken = token;
    localStorage.setItem('accessToken', token);
  }

  setRefreshToken(token: string) {
    this.refreshToken = token;
    localStorage.setItem('refreshToken', token);
  }

  setTokens(accessToken: string, refreshToken: string) {
    this.setAccessToken(accessToken);
    this.setRefreshToken(refreshToken);
  }

  clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
  }

  private async refreshAccessToken() {
    // Use axios directly to bypass interceptors
    return axios.post(`${API_BASE_URL}/auth/refresh-token`, {
      refreshToken: this.refreshToken,
    });
  }

  // Generic request methods
  async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.get<T>(url, config);
  }

  async post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.post<T>(url, data, config);
  }

  async put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.put<T>(url, data, config);
  }

  async patch<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.patch<T>(url, data, config);
  }

  async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.delete<T>(url, config);
  }

  /**
   * snake_case view of the API. Several POS screens were written against older snake_case row
   * shapes (table_number, service_charge, ...); the backend renders those when asked via the
   * X-Response-Case header. Request bodies may be camelCase or snake_case. Returns the unwrapped payload.
   */
  snake = {
    get: async <T = any>(url: string, params?: Record<string, any>): Promise<T> => {
      const clean = params ? Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')) : undefined;
      const r = await this.get(url, { params: clean, headers: { 'X-Response-Case': 'snake' } });
      return (r.data?.data ?? r.data) as T;
    },
    post: async <T = any>(url: string, body?: any): Promise<T> => {
      const r = await this.post(url, body, { headers: { 'X-Response-Case': 'snake' } });
      return (r.data?.data ?? r.data) as T;
    },
    put: async <T = any>(url: string, body?: any): Promise<T> => {
      const r = await this.put(url, body, { headers: { 'X-Response-Case': 'snake' } });
      return (r.data?.data ?? r.data) as T;
    },
    patch: async <T = any>(url: string, body?: any): Promise<T> => {
      const r = await this.patch(url, body, { headers: { 'X-Response-Case': 'snake' } });
      return (r.data?.data ?? r.data) as T;
    },
    delete: async <T = any>(url: string): Promise<T> => {
      const r = await this.delete(url, { headers: { 'X-Response-Case': 'snake' } });
      return (r.data?.data ?? r.data) as T;
    },
  };

  // Authentication methods organized under auth namespace
  auth = {
    login: async (credentials: { email: string; password: string }) => {
      const response = await this.post('/auth/login', credentials);
      const data = response.data.data || response.data;
      if (data.accessToken) {
        this.setTokens(data.accessToken, data.refreshToken);
      }
      return data;
    },

    register: async (data: { email: string; password: string; fullName?: string; phone?: string; role?: string }) => {
      const response = await this.post('/auth/register', data);
      const responseData = response.data.data || response.data;
      if (responseData.accessToken) {
        this.setTokens(responseData.accessToken, responseData.refreshToken);
      }
      return responseData;
    },

    logout: async () => {
      try {
        await this.post('/auth/logout');
      } finally {
        this.clearTokens();
      }
    },

    getProfile: async () => {
      const response = await this.get('/auth/profile');
      return response.data.data || response.data;
    },

    updateProfile: async (data: any) => {
      const response = await this.put('/auth/profile', data);
      return response.data.data || response.data;
    },

    getUsers: async (filters: any = {}) => {
      const params = new URLSearchParams(filters).toString();
      const response = await this.get(`/auth/users?${params}`);
      return response.data.data || response.data;
    },

    getUserRoles: async () => {
      const response = await this.get('/auth/roles');
      return response.data.data || response.data;
    },

    createUser: async (data: any) => {
      const response = await this.post('/auth/users', data);
      return response.data.data || response.data;
    },

    updateUser: async (id: string, data: any) => {
      const response = await this.put(`/auth/users/${id}`, data);
      return response.data.data || response.data;
    },

    deleteUser: async (id: string) => {
      const response = await this.delete(`/auth/users/${id}`);
      return response.data.data || response.data;
    },
  };

  // Tables namespace
  tables = {
    getAll: async (branchId?: string, filters: any = {}) => {
      const params = new URLSearchParams(branchId ? { branchId, ...filters } : filters).toString();
      const response = await this.get(`/tables?${params}`);
      return response.data.data || response.data;
    },

    getById: async (id: string) => {
      const response = await this.get(`/tables/${id}`);
      return response.data.data || response.data;
    },

    create: async (data: any) => {
      const response = await this.post('/tables', data);
      return response.data.data || response.data;
    },

    update: async (id: string, data: any) => {
      const response = await this.put(`/tables/${id}`, data);
      return response.data.data || response.data;
    },

    updateStatus: async (id: string, status: string) => {
      const response = await this.patch(`/tables/${id}/status`, { status });
      return response.data.data || response.data;
    },

    merge: async (primaryTableId: string, tableIds: string[]) => {
      const response = await this.post(`/tables/${primaryTableId}/merge`, { tableIds });
      return response.data.data || response.data;
    },

    unmerge: async (tableId: string) => {
      const response = await this.post(`/tables/${tableId}/unmerge`);
      return response.data.data || response.data;
    },

    shift: async (fromTableId: string, toTableId: string) => {
      const response = await this.post(`/tables/${fromTableId}/shift`, { toTableId });
      return response.data.data || response.data;
    },
  };

  // Orders namespace
  orders = {
    getAll: async (filters: any = {}) => {
      const params = new URLSearchParams(filters).toString();
      const response = await this.get(`/orders?${params}`);
      return response.data.data || response.data;
    },

    getById: async (id: string) => {
      const response = await this.get(`/orders/${id}`);
      return response.data.data || response.data;
    },

    create: async (data: any) => {
      const response = await this.post('/orders', data);
      return response.data.data || response.data;
    },

    updateStatus: async (id: string, status: string) => {
      const response = await this.patch(`/orders/${id}/status`, { status });
      return response.data.data || response.data;
    },

    addItems: async (id: string, items: any[]) => {
      const response = await this.post(`/orders/${id}/items`, { items });
      return response.data.data || response.data;
    },

    updateItem: async (orderId: string, itemId: string, data: any) => {
      const response = await this.patch(`/orders/${orderId}/items/${itemId}`, data);
      return response.data.data || response.data;
    },

    deleteItem: async (orderId: string, itemId: string) => {
      const response = await this.delete(`/orders/${orderId}/items/${itemId}`);
      return response.data.data || response.data;
    },
  };

  // Bills namespace
  bills = {
    getAll: async (filters: any = {}) => {
      const params = new URLSearchParams(filters).toString();
      const response = await this.get(`/billing?${params}`);
      return response.data.data || response.data;
    },

    getById: async (id: string) => {
      const response = await this.get(`/billing/${id}`);
      return response.data.data || response.data;
    },

    generate: async (orderId: string) => {
      const response = await this.post(`/billing/orders/${orderId}/generate`);
      return response.data.data || response.data;
    },

    addPayment: async (billId: string, data: any) => {
      const response = await this.post(`/billing/${billId}/payments`, data);
      return response.data.data || response.data;
    },

    split: async (orderId: string, splits: any[]) => {
      const response = await this.post(`/billing/orders/${orderId}/split`, { splits });
      return response.data.data || response.data;
    },

    applyDiscount: async (billId: string, discount: number) => {
      const response = await this.post(`/billing/${billId}/discount`, { discount });
      return response.data.data || response.data;
    },
  };

  // Inventory namespace
  inventory = {
    getAll: async (filters: any = {}) => {
      const params = new URLSearchParams(filters).toString();
      const response = await this.get(`/inventory?${params}`);
      return response.data.data || response.data || [];
    },
  };

  // Reservations namespace
  reservations = {
    getAll: async (filters: any = {}) => {
      const params = new URLSearchParams(filters).toString();
      const response = await this.get(`/reservations?${params}`);
      return response.data.data || response.data || [];
    },
  };

  // Menu
  menu = {
    getCategories: async (branchId: string) => {
      const response = await this.get(`/menu/categories?branchId=${branchId}`);
      return response.data.data || response.data;
    },

    getItems: async (filters: any = {}) => {
      const params = new URLSearchParams(filters).toString();
      const response = await this.get(`/menu/items?${params}`);
      return response.data.data || response.data;
    },

    createItem: async (data: any) => {
      const response = await this.post('/menu/items', data);
      return response.data.data || response.data;
    },

    updateItem: async (id: string, data: any) => {
      const response = await this.put(`/menu/items/${id}`, data);
      return response.data.data || response.data;
    },

    toggleAvailability: async (id: string, isAvailable: boolean) => {
      const response = await this.patch(`/menu/items/${id}/availability`, { isAvailable });
      return response.data.data || response.data;
    },
  };

  // Reports
  reports = {
    getData: async (filters: any = {}) => {
      const params = new URLSearchParams(filters).toString();
      const response = await this.get(`/billing/reports?${params}`);
      return response.data.data || response.data;
    },

    getOrderItems: async (filters: any = {}) => {
      const params = new URLSearchParams(filters).toString();
      const response = await this.get(`/orders/items?${params}`);
      return response.data.data || response.data;
    },
  };

  // Restaurant
  restaurant = {
    getAll: async () => {
      const response = await this.get('/restaurants');
      return response.data.data || response.data;
    },

    getById: async (id: string) => {
      const response = await this.get(`/restaurants/${id}`);
      return response.data.data || response.data;
    },

    getStats: async () => {
      const response = await this.get('/restaurants/stats');
      return response.data.data || response.data;
    },

    getDefaultBranch: async () => {
      const response = await this.get('/restaurants/default-branch');
      return response.data.data || response.data;
    },

    update: async (id: string, data: any) => {
      const response = await this.put(`/restaurants/${id}`, data);
      return response.data.data || response.data;
    },
  };
}

/** Human-readable message from an axios error produced by the API ({ message } body). */
export function errorMessage(error: any, fallback = 'Something went wrong'): string {
  const m = error?.response?.data?.message;
  if (typeof m === 'string' && m) return m;
  if (error?.code === 'ERR_NETWORK') return 'Cannot reach the server. Check your connection.';
  return error?.message || fallback;
}

export const apiClient = new ApiClient();
export default apiClient;
