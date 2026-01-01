/**
 * API utility functions for making HTTP requests to the backend
 */

// API Base URL - configured for AWS deployment
// Production: http://34.201.14.102/api
// Development: http://localhost:5000/api
const API_BASE_URL_RAW = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const API_BASE_URL = `${API_BASE_URL_RAW}/api`;

// Log configuration on load
console.log('🌐 API Base URL:', API_BASE_URL, '| Mode:', import.meta.env.MODE);

/**
 * Get the current user ID from localStorage
 * @returns {string|null} The user ID or null if not found
 */
export function getUserId() {
  try {
    // First priority: pc_userId (where LoginPage stores it)
    const pc_userId = localStorage.getItem('pc_userId');
    if (pc_userId) {
      console.log('✅ getUserId: Found pc_userId =', pc_userId);
      return String(pc_userId).trim();
    }
    
    // Fallback: try other keys
    const fallbackKeys = ['userId', 'user', 'userProfile', 'profile', 'currentUser'];
    for (const key of fallbackKeys) {
      const data = localStorage.getItem(key);
      if (data) {
        try {
          const parsed = JSON.parse(data);
          const userId = parsed.userId || parsed.id || parsed.user_id;
          if (userId) {
            console.log('✅ getUserId: Found', key, '=', userId);
            return String(userId).trim();
          }
        } catch {
          // Not JSON, try using as direct value
          if (data && !data.startsWith('{')) {
            console.log('✅ getUserId: Found', key, '=', data);
            return String(data).trim();
          }
        }
      }
    }
    
    // No user ID found
    console.warn('⚠️  getUserId: No user ID found in localStorage. Available keys:', Object.keys(localStorage).filter(k => !k.startsWith('vite')));
    console.warn('⚠️  Using default userId=1. This should only happen in development mode.');
    return '1';
  } catch (e) {
    console.error('❌ getUserId error:', e);
    return '1';
  }
}

/**
 * Get authentication token from localStorage
 * @returns {string|null} The auth token or null if not found
 */
export function getAuthToken() {
  try {
    return localStorage.getItem('pc_token') || localStorage.getItem('token') || localStorage.getItem('authToken') || null;
  } catch (e) {
    console.error('Error getting auth token:', e);
    return null;
  }
}

/**
 * Build headers for API requests
 * @returns {Object} Headers object
 */
function getHeaders() {
  const headers = {
    'Content-Type': 'application/json'
  };
  
  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  return headers;
}

/**
 * Make a GET request to the API
 * @param {string} endpoint - The API endpoint (without /api prefix)
 * @param {Object} options - Additional fetch options
 * @returns {Promise<any>} The response data
 */
export async function apiGet(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  const token = getAuthToken();
  const userId = getUserId();
  
  console.log('📡 API GET Request:', {
    endpoint,
    fullUrl: url,
    hasToken: !!token,
    tokenPreview: token ? token.substring(0, 30) + '...' : 'NONE',
    userId,
  });
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: getHeaders(),
      ...options
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
      console.error('❌ API GET failed:', {
        endpoint,
        status: response.status,
        statusText: response.statusText,
        error: errorData
      });
      throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('✅ API GET success:', endpoint, data);
    return data;
  } catch (error) {
    console.error(`❌ API GET ${endpoint} failed:`, error);
    throw error;
  }
}

/**
 * Make a POST request to the API
 * @param {string} endpoint - The API endpoint (without /api prefix)
 * @param {Object} data - The request body data
 * @param {Object} options - Additional fetch options
 * @returns {Promise<any>} The response data
 */
export async function apiPost(endpoint, data, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
      ...options
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
      throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error(`API POST ${endpoint} failed:`, error);
    throw error;
  }
}

/**
 * Make a PUT request to the API
 * @param {string} endpoint - The API endpoint (without /api prefix)
 * @param {Object} data - The request body data
 * @param {Object} options - Additional fetch options
 * @returns {Promise<any>} The response data
 */
export async function apiPut(endpoint, data, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  
  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data),
      ...options
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
      throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error(`API PUT ${endpoint} failed:`, error);
    throw error;
  }
}

/**
 * Make a PATCH request to the API
 * @param {string} endpoint - The API endpoint (without /api prefix)
 * @param {Object} data - The request body data
 * @param {Object} options - Additional fetch options
 * @returns {Promise<any>} The response data
 */
export async function apiPatch(endpoint, data, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  
  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify(data),
      ...options
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
      throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error(`API PATCH ${endpoint} failed:`, error);
    throw error;
  }
}

/**
 * Make a DELETE request to the API
 * @param {string} endpoint - The API endpoint (without /api prefix)
 * @param {Object} options - Additional fetch options
 * @returns {Promise<any>} The response data
 */
export async function apiDelete(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  
  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: getHeaders(),
      ...options
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
      throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
    }
    
    // DELETE might return no content
    if (response.status === 204) {
      return null;
    }
    
    return await response.json();
  } catch (error) {
    console.error(`API DELETE ${endpoint} failed:`, error);
    throw error;
  }
}

/**
 * Upload a file to the API
 * @param {string} endpoint - The API endpoint (without /api prefix)
 * @param {FormData} formData - The form data containing the file
 * @param {Object} options - Additional fetch options
 * @returns {Promise<any>} The response data
 */
export async function apiUpload(endpoint, formData, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  
  try {
    const headers = {};
    const token = getAuthToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    // Don't set Content-Type for FormData - browser will set it with boundary
    
    const response = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: formData,
      ...options
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
      throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error(`API UPLOAD ${endpoint} failed:`, error);
    throw error;
  }
}
