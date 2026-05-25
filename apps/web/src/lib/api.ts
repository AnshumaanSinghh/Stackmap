import axios from "axios";
import { Board, CanvasObject, ApiResponse, User } from "@stackmap/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

const api = axios.create({
  baseURL: API_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// Add auth token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auth endpoints
export const authApi = {
  register: (email: string, password: string, name: string) =>
    api.post<ApiResponse<{ user: User; token: string }>>("/auth/register", {
      email,
      password,
      name,
    }),

  login: (email: string, password: string) =>
    api.post<ApiResponse<{ user: User; token: string }>>("/auth/login", {
      email,
      password,
    }),

  logout: () => api.post<ApiResponse<void>>("/auth/logout"),
};

// Board endpoints
export const boardApi = {
  list: () => api.get<ApiResponse<Board[]>>("/api/boards"),

  get: (boardId: string) => api.get<ApiResponse<Board>>(`/api/boards/${boardId}`),

  create: (title: string, description?: string) =>
    api.post<ApiResponse<Board>>("/api/boards", { title, description }),

  update: (boardId: string, updates: Partial<Board>) =>
    api.put<ApiResponse<Board>>(`/api/boards/${boardId}`, updates),

  delete: (boardId: string) => api.delete<ApiResponse<void>>(`/api/boards/${boardId}`),
};

// Object endpoints
export const objectApi = {
  list: (boardId: string) =>
    api.get<ApiResponse<CanvasObject[]>>(`/api/boards/${boardId}/objects`),

  create: (boardId: string, object: CanvasObject) =>
    api.post<ApiResponse<CanvasObject>>(`/api/boards/${boardId}/objects`, object),

  update: (boardId: string, objectId: string, updates: Partial<CanvasObject>) =>
    api.put<ApiResponse<CanvasObject>>(
      `/api/boards/${boardId}/objects/${objectId}`,
      updates
    ),

  delete: (boardId: string, objectId: string) =>
    api.delete<ApiResponse<void>>(`/api/boards/${boardId}/objects/${objectId}`),
};

// AI endpoints
export const aiApi = {
  review: (boardId: string, focusAreas?: string[]) =>
    api.post<ApiResponse<{ review: string }>>("/api/ai/review", {
      boardId,
      focusAreas,
    }),

  generate: (description: string, systemType?: string) =>
    api.post<ApiResponse<{ architecture: string }>>("/api/ai/generate", {
      description,
      systemType,
    }),

  cleanup: (boardId: string) =>
    api.post<ApiResponse<{ suggestions: string[] }>>("/api/ai/cleanup", {
      boardId,
    }),

  search: (boardId: string, query: string) =>
    api.post<ApiResponse<{ results: CanvasObject[] }>>("/api/ai/search", {
      boardId,
      query,
    }),
};

export default api;
