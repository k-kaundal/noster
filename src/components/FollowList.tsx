import { Link } from 'react-router-dom';
import { useFollows } from '@/hooks/useFollows';
import { useFollowers } from '@/hooks/useFollowers';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { genUserName } from '@/lib/genUserName';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UserPlus, UserMinus, Users, Loader2 } from 'lucide-react';
import { nip19 } from 'nostr-tools';

interface FollowListProps {
  pubkey: string;
  defaultTab?: 'following' | 'followers';
}

interface UserItemProps {
  pubkey: string;
  petname?: string;
}

function UserItem({ pubkey, petname }: UserItemProps) {
  const author = useAuthor(pubkey);
  const { user } = useCurrentUser();
  const { isFollowing, follow, unfollow, isFollowLoading } = useFollows(pubkey);
  
  const metadata = author.data?.metadata;
  const displayName = metadata?.display_name || metadata?.name || petname || genUserName(pubkey);
  const username = metadata?.name || genUserName(pubkey);
  const profileImage = metadata?.picture;
  const bio = metadata?.about;
  const npub = nip19.npubEncode(pubkey);
  
  const isCurrentUser = user?.pubkey === pubkey;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-start space-x-3 flex-1">
            <Link to={`/${npub}`}>
              <Avatar className="h-12 w-12">
                <AvatarImage src={profileImage} alt={displayName} />
                <AvatarFallback>{displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
            </Link>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center space-x-2">
                <Link to={`/${npub}`} className="font-semibold hover:underline truncate">
                  {displayName}
                </Link>
                {metadata?.nip05 && (
                  <Badge variant="secondary" className="text-xs">
                    ✓
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground truncate">@{username}</p>
              {bio && (
                <p className="text-sm mt-1 line-clamp-2">{bio}</p>
              )}
            </div>
          </div>

          {!isCurrentUser && user && (
            <Button
              size="sm"
              variant={isFollowing ? "outline" : "default"}
              onClick={() => isFollowing ? unfollow(pubkey) : follow(pubkey)}
              disabled={isFollowLoading}
            >
              {isFollowLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isFollowing ? (
                <>
                  <UserMinus className="h-4 w-4 mr-1" />
                  Unfollow
                </>
              ) : (
                <>
                  <UserPlus className="h-4 w-4 mr-1" />
                  Follow
                </>
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function UserItemSkeleton() {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start space-x-3">
          <Skeleton className="h-12 w-12 rounded-full" />
          <div className="flex-1 space-y-2">
            <div className="space-y-1">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-3 w-full" />
          </div>
          <Skeleton className="h-8 w-20" />
        </div>
      </CardContent>
    </Card>
  );
}

export function FollowList({ pubkey, defaultTab = 'following' }: FollowListProps) {
  const { followingList, followingCount, isLoading: followingLoading } = useFollows(pubkey);
  const { followerPubkeys, followerCount, isLoading: followersLoading } = useFollowers(pubkey);

  return (
    <div className="max-w-2xl mx-auto">
      <Tabs defaultValue={defaultTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="following">
            Following ({followingCount})
          </TabsTrigger>
          <TabsTrigger value="followers">
            Followers ({followerCount})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="following" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Users className="h-5 w-5" />
                <span>Following</span>
              </CardTitle>
            </CardHeader>
          </Card>

          {followingLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <UserItemSkeleton key={i} />
              ))}
            </div>
          ) : followingList.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-12 px-8 text-center">
                <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                <h3 className="text-lg font-semibold mb-2">No following yet</h3>
                <p className="text-muted-foreground">
                  This user isn't following anyone yet.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {followingList.map((follow) => (
                <UserItem
                  key={follow.pubkey}
                  pubkey={follow.pubkey}
                  petname={follow.petname}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="followers" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Users className="h-5 w-5" />
                <span>Followers</span>
              </CardTitle>
            </CardHeader>
          </Card>

          {followersLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <UserItemSkeleton key={i} />
              ))}
            </div>
          ) : followerPubkeys.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-12 px-8 text-center">
                <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                <h3 className="text-lg font-semibold mb-2">No followers yet</h3>
                <p className="text-muted-foreground">
                  This user doesn't have any followers yet.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {followerPubkeys.map((followerPubkey) => (
                <UserItem
                  key={followerPubkey}
                  pubkey={followerPubkey}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}