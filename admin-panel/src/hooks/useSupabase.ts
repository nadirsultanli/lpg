import { useState, useEffect } from 'react';
import { supabase } from '../utils/supabase';

export const useSupabaseQuery = <T>(
  queryFn: () => any,
  dependencies: any[] = []
) => {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        const { data: result, error: queryError } = await queryFn();
        
        if (queryError) {
          setError(queryError.message);
        } else {
          setData(result);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, dependencies);

  return { data, loading, error, refetch: () => fetchData };
};

export const useSupabaseMutation = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutate = async (mutationFn: () => any) => {
    try {
      setLoading(true);
      setError(null);
      const result = await mutationFn();
      
      if (result.error) {
        setError(result.error.message);
        return { success: false, error: result.error.message };
      }
      
      return { success: true, data: result.data };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An error occurred';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setLoading(false);
    }
  };

  return { mutate, loading, error };
};