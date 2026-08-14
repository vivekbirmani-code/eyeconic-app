import { api } from './api';
import { getApiConfigDiagnostics } from './config';

export interface ApiHealthDiagnostics {
  config: ReturnType<typeof getApiConfigDiagnostics>;
  reachable: boolean;
  status?: number;
  healthStatus?: string;
  latencyMs?: number;
  error?: string;
}

/**
 * Development-only connectivity check against the configured API host.
 * Never logs credentials or auth tokens.
 */
export const checkApiHealth = async (): Promise<ApiHealthDiagnostics> => {
  const config = getApiConfigDiagnostics();
  const startedAt = Date.now();

  try {
    const response = await api.get('/health', {
      timeout: 10000,
      headers: { 'X-Diagnostic': 'true' },
    });

    return {
      config,
      reachable: true,
      status: response.status,
      healthStatus: response.data?.status,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    const axiosError = error as { message?: string; response?: { status?: number; data?: { status?: string } } };

    return {
      config,
      reachable: false,
      status: axiosError.response?.status,
      healthStatus: axiosError.response?.data?.status,
      latencyMs: Date.now() - startedAt,
      error: axiosError.message,
    };
  }
};

export const logApiDiagnostics = async (): Promise<ApiHealthDiagnostics> => {
  const diagnostics = await checkApiHealth();

  if (__DEV__) {
    console.log('[api-diagnostics]', JSON.stringify(diagnostics, null, 2));
  }

  return diagnostics;
};
