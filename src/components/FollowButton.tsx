import { useFollows } from '@/hooks/useFollows';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { Button } from '@/components/ui/button';
import { UserPlus, UserMinus, Loader2 } from 'lucide-react';

interface FollowButtonProps {
  pubkey: string;
  size?: 'sm' | 'default' | 'lg';
  variant?: 'default' | 'outline' | 'ghost';
  className?: string;
}

export function FollowButton({ 
  pubkey, 
  size = 'sm', 
  variant = 'outline',
  className 
}: FollowButtonProps) {
  const { user } = useCurrentUser();
  const { isFollowing, follow, unfollow, isFollowLoading } = useFollows(pubkey);

  // Don't show follow button for current user or if not logged in
  if (!user || user.pubkey === pubkey) {
    return null;
  }

  return (
    <Button
      size={size}
      variant={isFollowing ? "ghost" : variant}
      onClick={() => isFollowing ? unfollow(pubkey) : follow(pubkey)}
      disabled={isFollowLoading}
      className={className}
    >
      {isFollowLoading ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : isFollowing ? (
        <>
          <UserMinus className="h-3 w-3 mr-1" />
          Unfollow
        </>
      ) : (
        <>
          <UserPlus className="h-3 w-3 mr-1" />
          Follow
        </>
      )}
    </Button>
  );
}