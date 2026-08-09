import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Zap, QrCode, Lock, Key } from 'lucide-react';
import { LoginArea } from '@/components/auth/LoginArea';

interface ModernLoginDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Modern, professional login dialog with multiple authentication methods
 * Features: Clean design, multiple tabs, clear visual hierarchy
 */
export function ModernLoginDialog({
  open = false,
  onOpenChange,
}: ModernLoginDialogProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <Zap className="h-6 w-6 text-yellow-500" />
            <DialogTitle className="text-2xl">Welcome to NostrFeed</DialogTitle>
          </div>
          <DialogDescription className="text-base">
            Join the decentralized social network powered by Lightning
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="nostr" className="w-full mt-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="nostr" className="flex items-center gap-2">
              <Zap className="h-4 w-4" />
              <span className="hidden sm:inline">Nostr</span>
            </TabsTrigger>
            <TabsTrigger value="username" className="flex items-center gap-2">
              <Lock className="h-4 w-4" />
              <span className="hidden sm:inline">Username</span>
            </TabsTrigger>
            <TabsTrigger value="qr" className="flex items-center gap-2">
              <QrCode className="h-4 w-4" />
              <span className="hidden sm:inline">QR Code</span>
            </TabsTrigger>
          </TabsList>

          {/* Nostr Login */}
          <TabsContent value="nostr" className="space-y-4 mt-6">
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Use your Nostr signer extension to sign in securely without passwords
              </p>
              <LoginArea className="w-full" />
            </div>
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
              <h4 className="font-semibold text-sm mb-2">Need an extension?</h4>
              <p className="text-xs text-muted-foreground mb-3">
                Download a Nostr signer browser extension first:
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" asChild>
                  <a href="https://alby.com" target="_blank" rel="noopener noreferrer">
                    Alby
                  </a>
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <a href="https://github.com/getalby/nos2x" target="_blank" rel="noopener noreferrer">
                    nos2x
                  </a>
                </Button>
              </div>
            </div>
          </TabsContent>

          {/* Username Login */}
          <TabsContent value="username" className="space-y-4 mt-6">
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Sign in with your username and password
              </p>

              <div className="space-y-2">
                <Label htmlFor="username" className="text-sm font-medium">
                  Username
                </Label>
                <Input
                  id="username"
                  placeholder="Enter your username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="h-10"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium">
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-10"
                />
              </div>

              <Button className="w-full h-10 font-semibold">
                Sign In
              </Button>

              <Button variant="ghost" className="w-full">
                Forgot password?
              </Button>
            </div>
          </TabsContent>

          {/* QR Code Login */}
          <TabsContent value="qr" className="space-y-4 mt-6">
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Scan this QR code with your Nostr mobile app
              </p>

              <div className="flex justify-center py-8">
                <div className="w-48 h-48 bg-muted rounded-lg flex items-center justify-center border-2 border-dashed border-border">
                  <QrCode className="h-12 w-12 text-muted-foreground" />
                </div>
              </div>

              <p className="text-xs text-muted-foreground text-center">
                QR code expires in 5 minutes
              </p>
            </div>
          </TabsContent>
        </Tabs>

        {/* Footer */}
        <div className="mt-6 pt-6 border-t border-border">
          <p className="text-xs text-muted-foreground text-center">
            By signing in, you agree to our{' '}
            <a href="#" className="text-primary hover:underline">
              Terms of Service
            </a>{' '}
            and{' '}
            <a href="#" className="text-primary hover:underline">
              Privacy Policy
            </a>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
