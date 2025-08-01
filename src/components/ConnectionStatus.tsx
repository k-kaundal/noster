import { useState, useEffect } from 'react';
import { useAppContext } from '@/hooks/useAppContext';
import { Badge } from '@/components/ui/badge';
import { Wifi, WifiOff, AlertCircle } from 'lucide-react';

export function ConnectionStatus() {
  const { config } = useAppContext();
  const [status, setStatus] = useState<'connected' | 'connecting' | 'disconnected'>('connecting');
  const [, setLastUpdate] = useState<Date>(new Date());

  useEffect(() => {
    let ws: WebSocket | null = null;
    let timeoutId: NodeJS.Timeout;

    const connect = () => {
      try {
        setStatus('connecting');
        ws = new WebSocket(config.relayUrl);

        ws.onopen = () => {
          setStatus('connected');
          setLastUpdate(new Date());
        };

        ws.onclose = () => {
          setStatus('disconnected');
          // Attempt to reconnect after 5 seconds
          timeoutId = setTimeout(connect, 5000);
        };

        ws.onerror = () => {
          setStatus('disconnected');
        };
      } catch {
        setStatus('disconnected');
        timeoutId = setTimeout(connect, 5000);
      }
    };

    connect();

    return () => {
      if (ws) {
        ws.close();
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [config.relayUrl]);

  const getStatusConfig = () => {
    switch (status) {
      case 'connected':
        return {
          icon: Wifi,
          text: 'Connected',
          variant: 'default' as const,
          className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
        };
      case 'connecting':
        return {
          icon: AlertCircle,
          text: 'Connecting...',
          variant: 'secondary' as const,
          className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
        };
      case 'disconnected':
        return {
          icon: WifiOff,
          text: 'Disconnected',
          variant: 'destructive' as const,
          className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
        };
    }
  };

  const statusConfig = getStatusConfig();
  const Icon = statusConfig.icon;

  return (
    <Badge
      variant={statusConfig.variant}
      className={`${statusConfig.className} transition-all duration-200 animate-pulse`}
    >
      <Icon className="h-3 w-3 mr-1" />
      {statusConfig.text}
    </Badge>
  );
}