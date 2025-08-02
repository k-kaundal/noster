import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useProfile } from '@/hooks/useProfile';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useFollows } from '@/hooks/useFollows';
import { useFollowers } from '@/hooks/useFollowers';
import { genUserName } from '@/lib/genUserName';
import { Post } from '@/components/Post';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { RelaySelector } from '@/components/RelaySelector';
import { Calendar, Link as LinkIcon, MapPin, Users, Loader2, UserPlus, UserMinus } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { nip19 } from 'nostr-tools';
import { Dialog, DialogContent, DialogTitle, DialogTrigger, DialogPortal, DialogOverlay } from '@radix-ui/react-dialog';
import { EditProfileForm } from './EditProfileForm';

interface ProfileProps {
  pubkey: string;
}

export function Profile({ pubkey }: ProfileProps) {
  const { data: profileData, isLoading, error } = useProfile(pubkey);
  const author = useAuthor(pubkey);
  const { user } = useCurrentUser();
  const { followingCount, isFollowing, follow, unfollow, isFollowLoading } = useFollows(pubkey);
  const { followerCount } = useFollowers(pubkey);
  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);

  const metadata = author.data?.metadata;
  const displayName = metadata?.display_name || metadata?.name || genUserName(pubkey);
  const username = metadata?.name || genUserName(pubkey);
  const profileImage = metadata?.picture;
  const bannerImage = metadata?.banner;
  const bio = metadata?.about;
  const website = metadata?.website;
  const location = (metadata as Record<string, unknown>)?.location as string | undefined;
  const isCurrentUser = user?.pubkey === pubkey;
  const npub = nip19.npubEncode(pubkey);

  if (error) {
    return (
      <div className="col-span-full">
        <Card className="border-dashed">
          <CardContent className="py-12 px-8 text-center">
            <div className="max-w-sm mx-auto space-y-6">
              <p className="text-muted-foreground">
                Failed to load profile. Try another relay?
              </p>
              <RelaySelector className="w-full" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        {/* Skeleton code unchanged */}
        <Card>
          <div className="relative">
            <Skeleton className="h-48 w-full" />
            <div className="absolute -bottom-16 left-6">
              <Skeleton className="h-32 w-32 rounded-full border-4 border-background" />
            </div>
          </div>
          <CardContent className="pt-20 pb-6">
            <div className="space-y-4">
              <div className="flex justify-between items-start">
                <div className="space-y-2">
                  <Skeleton className="h-6 w-32" />
                  <Skeleton className="h-4 w-24" />
                </div>
                <Skeleton className="h-9 w-24" />
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <div className="flex space-x-4">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-20" />
              </div>
            </div>
          </CardContent>
        </Card>
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="flex items-start space-x-3">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center space-x-2">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-4 w-16" />
                    </div>
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-4/5" />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const posts = profileData?.posts || [];
  const joinedDate = (() => {
    try {
      if (posts.length === 0) return new Date();
      const timestamps = posts.map(p => p.created_at).filter(t => t > 0);
      if (timestamps.length === 0) return new Date();
      const minTimestamp = Math.min(...timestamps) * 1000;
      if (minTimestamp <= 0 || minTimestamp > Date.now()) return new Date();
      return new Date(minTimestamp);
    } catch {
      return new Date();
    }
  })();

  return (
    <div className="space-y-6">
      <Card>
        <div className="relative">
          <div className="h-48 bg-gradient-to-r from-blue-500 to-purple-600 rounded-t-lg overflow-hidden">
            {bannerImage && (
              <img
                src={bannerImage}
                alt="Profile banner"
                className="w-full h-full object-cover"
              />
            )}
          </div>
          <div className="absolute -bottom-16 left-6">
            <Avatar className="h-32 w-32 border-4 border-background">
              <AvatarImage src={profileImage} alt={displayName} />
              <AvatarFallback className="text-2xl">
                {displayName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </div>
        </div>

        <CardContent className="pt-20 pb-6">
          <div className="space-y-4">
            <div className="flex justify-between items-start">
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <h1 className="text-2xl font-bold">{displayName}</h1>
                  {metadata?.nip05 && (
                    <Badge variant="secondary">
                      ✓ Verified
                    </Badge>
                  )}
                </div>
                <p className="text-muted-foreground">@{username}</p>
              </div>
              {isCurrentUser ? (
                <Dialog open={isEditProfileOpen} onOpenChange={(open) => {
                  setIsEditProfileOpen(open);
                }}>
                  <DialogTrigger asChild>
                    <Button
                      variant="outline"
                    >
                      Edit Profile
                    </Button>
                  </DialogTrigger>
                  <DialogPortal>
                    <DialogOverlay className="fixed inset-0 bg-black/50" />
                    <DialogContent className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white p-6 rounded-lg shadow-lg max-w-lg w-full">
                      <DialogTitle>Edit Profile</DialogTitle>
                      <EditProfileForm onSuccess={() => {
                        setIsEditProfileOpen(false);
                      }} />
                    </DialogContent>
                  </DialogPortal>
                </Dialog>
              ) : (
                <Button
                  onClick={() => isFollowing ? unfollow(pubkey) : follow(pubkey)}
                  disabled={isFollowLoading}
                  variant={isFollowing ? "outline" : "default"}
                >
                  {isFollowLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {isFollowing ? 'Unfollowing...' : 'Following...'}
                    </>
                  ) : isFollowing ? (
                    <>
                      <UserMinus className="h-4 w-4 mr-2" />
                      Unfollow
                    </>
                  ) : (
                    <>
                      <UserPlus className="h-4 w-4 mr-2" />
                      Follow
                    </>
                  )}
                </Button>
              )}
            </div>
            {bio && (
              <p className="text-sm leading-relaxed">{bio}</p>
            )}
            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
              {location && (
                <div className="flex items-center space-x-1">
                  <MapPin className="h-4 w-4" />
                  <span>{location}</span>
                </div>
              )}
              {website && (
                <div className="flex items-center space-x-1">
                  <LinkIcon className="h-4 w-4" />
                  <a
                    href={website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    {website.replace(/^https?:\/\//, '')}
                  </a>
                </div>
              )}
              <div className="flex items-center space-x-1">
                <Calendar className="h-4 w-4" />
                <span>
                  Joined {formatDistanceToNow(joinedDate, { addSuffix: true })}
                </span>
              </div>
            </div>
            <div className="flex space-x-6 text-sm">
              <div className="flex items-center space-x-1">
                <span className="font-semibold">{posts.length}</span>
                <span className="text-muted-foreground">Posts</span>
              </div>
              <Link
                to={`/${npub}/following`}
                className="flex items-center space-x-1 hover:underline"
              >
                <span className="font-semibold">{followingCount}</span>
                <span className="text-muted-foreground">Following</span>
              </Link>
              <Link
                to={`/${npub}/followers`}
                className="flex items-center space-x-1 hover:underline"
              >
                <span className="font-semibold">{followerCount}</span>
                <span className="text-muted-foreground">Followers</span>
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Posts</h2>
        {posts.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-12 px-8 text-center">
              <div className="max-w-sm mx-auto space-y-4">
                <Users className="h-12 w-12 mx-auto text-muted-foreground" />
                <p className="text-muted-foreground">
                  {isCurrentUser ? "You haven't posted anything yet." : "No posts found."}
                </p>
                {isCurrentUser && (
                  <Button>
                    Create your first post
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {posts.map((post) => (
              <Post key={post.id} event={post} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}