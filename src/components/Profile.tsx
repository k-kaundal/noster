import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useProfile } from '@/hooks/useProfile';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useFollows } from '@/hooks/useFollows';
import { useFollowers } from '@/hooks/useFollowers';
import { genUserName } from '@/lib/genUserName';
import { Post } from '@/components/Post';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { RelaySelector } from '@/components/RelaySelector';
import { Calendar, Link as LinkIcon, MapPin, Users, Loader2, UserPlus, UserMinus, QrCode, Copy } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { nip19 } from 'nostr-tools';
import { Dialog, DialogContent, DialogTrigger, DialogTitle } from '@radix-ui/react-dialog';
import { EditProfileForm } from './EditProfileForm';
import { QRCodeSVG } from 'qrcode.react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from '@/hooks/useToast';
import sanitizeHtml from 'sanitize-html';
import * as emoji from 'node-emoji'

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
  const [showDetails, setShowDetails] = useState(false);

  const metadata = author.data?.metadata;
  const displayName = metadata?.display_name || metadata?.name || genUserName(pubkey);
  const username = metadata?.name || genUserName(pubkey);
  const profileImage = metadata?.picture;
  const bannerImage = metadata?.banner;
  const bio = metadata?.about;
  const website = metadata?.website;
  const location = (metadata as Record<string, unknown>)?.location as string | undefined;
  const lud06 = metadata?.lud06;
  const lud16 = metadata?.lud16;
  const isCurrentUser = user?.pubkey === pubkey;
  const npub = nip19.npubEncode(pubkey);

  if (error) {
    return (
      <div className="col-span-full">
        <Card className="border-dashed bg-card/50 backdrop-blur-sm">
          <CardContent className="py-12 px-8 text-center">
            <div className="max-w-sm mx-auto space-y-6">
              <p className="text-muted-foreground">Failed to load profile. Try another relay?</p>
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
        <Card className="bg-card/50 backdrop-blur-sm">
          <div className="relative">
            <Skeleton className="h-48 w-full bg-gray-200/50" />
            <div className="absolute -bottom-16 left-6">
              <Skeleton className="h-32 w-32 rounded-full border-4 border-background bg-gray-200/50" />
            </div>
          </div>
          <CardContent className="pt-20 pb-6">
            <div className="space-y-4">
              <div className="flex justify-between items-start">
                <div className="space-y-2">
                  <Skeleton className="h-6 w-32 bg-gray-200/50" />
                  <Skeleton className="h-4 w-24 bg-gray-200/50" />
                </div>
                <Skeleton className="h-9 w-24 bg-gray-200/50" />
              </div>
              <Skeleton className="h-4 w-full bg-gray-200/50" />
              <div className="flex space-x-4">
                <Skeleton className="h-4 w-20 bg-gray-200/50" />
                <Skeleton className="h-4 w-20 bg-gray-200/50" />
              </div>
            </div>
          </CardContent>
        </Card>
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="bg-card/50 backdrop-blur-sm">
              <CardContent className="p-6">
                <div className="flex items-start space-x-3">
                  <Skeleton className="h-10 w-10 rounded-full bg-gray-200/50" />
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center space-x-2">
                      <Skeleton className="h-4 w-24 bg-gray-200/50" />
                      <Skeleton className="h-4 w-16 bg-gray-200/50" />
                    </div>
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-full bg-gray-200/50" />
                      <Skeleton className="h-4 w-4/5 bg-gray-200/50" />
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

  const isVerified = !!metadata?.nip05;

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast({ title: `${label} copied to clipboard!`, description: text.substring(0, 20) + '...', duration: 2000 });
    }).catch(err => {
      toast({ title: 'Copy failed', description: err.message, variant: 'destructive' });
    });
  };

const renderBio = (bio: string, pubkey: string) => {
  if (!bio) return null;

  // Regular expressions for parsing
  const mentionRegex = /@([a-zA-Z0-9_]+|npub1[0-9a-zA-Z]+)/g;
  const urlRegex = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/g;
  const emojiRegex = /:([a-zA-Z0-9_]+):/g;

  // Split the bio, but avoid capturing groups in the split regex
  const parts = bio.split(/(https?:\/\/[^\s<]+[^<.,:;"')\]\s]|@[a-zA-Z0-9_]+|@[npub1][0-9a-zA-Z]+|:([a-zA-Z0-9_]+):)/g).filter(part => part !== undefined && part !== null);

  return parts.map((part, index) => {
    // Skip empty or undefined parts
    if (!part || typeof part !== 'string') {
      return null;
    }

    // Handle mentions
    if (part.match(mentionRegex)) {
      const mention = part.slice(1); // Remove '@'
      // Check if it's an npub key
      if (mention.startsWith('npub1')) {
        try {
          const { data } = nip19.decode(mention);
          return (
            <Link
              key={index}
              to={`/${mention}`}
              className="text-blue-600 hover:underline"
              title={`View profile for ${mention}`}
            >
              {part}
            </Link>
          );
        } catch {
          return <span key={index}>{part}</span>; // Invalid npub, render as plain text
        }
      }
      // Handle username mentions (adjust based on your routing logic)
      return (
        <Link
          key={index}
          to={`/${mention}`} // Adjust if you resolve usernames to npub
          className="text-blue-600 hover:underline"
          title={`View profile for ${mention}`}
        >
          {part}
        </Link>
      );
    }

    // Handle URLs
    if (part.match(urlRegex)) {
      return (
        <a
          key={index}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline"
          title="Open link in new tab"
        >
          {part}
        </a>
      );
    }

    // Handle emojis
    if (part.match(emojiRegex)) {
      const emojiName = part.slice(1, -1); // Remove ':' from start and end
      const emojiChar = emoji.get(emojiName);
      return emojiChar ? (
        <span key={index} title={emojiName}>
          {emojiChar}
        </span>
      ) : (
        <span key={index}>{part}</span>
      );
    }

    // Render plain text, sanitized
    return (
      <span
        key={index}
        dangerouslySetInnerHTML={{
          __html: sanitizeHtml(part, {
            allowedTags: [],
            allowedAttributes: {},
          }),
        }}
      />
    );
  });
};

  return (
    <div className="space-y-6 mx-auto">
      <Card className="overflow-hidden shadow-lg bg-white/80 backdrop-blur-md border border-gray-200/50 rounded-xl">
        <div className="relative">
          <div className="h-48 bg-gradient-to-r from-blue-500 to-purple-600 rounded-t-xl overflow-hidden">
            {bannerImage ? (
              <img src={bannerImage} alt="Profile banner" className="w-full h-full object-cover transition-opacity duration-300 hover:opacity-90" />
            ) : (
              <div className="w-full h-full bg-gray-200 flex items-center justify-center">
                <span className="text-white text-sm">No banner set</span>
              </div>
            )}
          </div>
          <div className="absolute -bottom-16 left-6">
            <Avatar className="h-32 w-32 border-4 border-white shadow-lg transition-transform duration-300 hover:scale-105">
              <AvatarImage src={profileImage} alt={displayName} className="object-cover" />
              <AvatarFallback className="text-2xl bg-gray-200 text-gray-800 flex items-center justify-center">
                {displayName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </div>
        </div>

        <CardContent className="pt-20 pb-6 px-6">
          <div className="space-y-6">
            <div className="flex justify-between items-start">
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <h1 className="text-3xl font-bold text-gray-900 transition-colors hover:text-blue-600">{displayName}</h1>
                  {isVerified ? (
                    <Badge variant="secondary" className="bg-green-100 text-green-800 hover:bg-green-200 relative group">
                      <span className="tooltip" data-tooltip={metadata.nip05}>
                        ✓ Verified
                      </span>
                      <span className="absolute hidden group-hover:block bg-gray-800 text-white text-xs p-2 rounded-md -top-10 left-1/2 transform -translate-x-1/2 whitespace-nowrap z-10">
                        {metadata.nip05}
                      </span>
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-yellow-100 text-yellow-800 hover:bg-yellow-200">
                      Unverified
                    </Badge>
                  )}
                </div>
                <p className="text-muted-foreground text-sm">@{username}</p>
              </div>
              {isCurrentUser ? (
                <Dialog open={isEditProfileOpen} onOpenChange={setIsEditProfileOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" className="bg-white hover:bg-gray-100 border-2 border-gray-300 transition-all duration-300 hover:shadow-md">
                      Edit Profile
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="bg-white/90 backdrop-blur-md p-6 rounded-xl shadow-lg max-w-md">
                    <DialogTitle className="text-2xl font-semibold text-gray-900">Edit Profile</DialogTitle>
                    <EditProfileForm onSuccess={() => setIsEditProfileOpen(false)} />
                  </DialogContent>
                </Dialog>
              ) : (
                <Button
                  onClick={() => isFollowing ? unfollow(pubkey) : follow(pubkey)}
                  disabled={isFollowLoading}
                  variant={isFollowing ? "outline" : "default"}
                  className={`${
                    isFollowing ? "bg-white hover:bg-gray-100 border-2 border-gray-300" : "bg-blue-600 text-white hover:bg-blue-700"
                  } transition-all duration-300 hover:shadow-md`}
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
                <p className="text-sm leading-relaxed text-gray-700 transition-opacity duration-300 hover:opacity-80">
                  {renderBio(bio, pubkey)}
                </p>
              )}
            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
              {location && (
                <div className="flex items-center space-x-1 transition-transform duration-300 hover:scale-105">
                  <MapPin className="h-4 w-4 text-gray-500" />
                  <span className="text-gray-600">{location}</span>
                </div>
              )}
              {website && (
                <div className="flex items-center space-x-1 transition-transform duration-300 hover:scale-105">
                  <LinkIcon className="h-4 w-4 text-gray-500" />
                  <a
                    href={website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline transition-colors"
                  >
                    {website.replace(/^https?:\/\//, '')}
                  </a>
                </div>
              )}
              <div className="flex items-center space-x-1 transition-transform duration-300 hover:scale-105">
                <Calendar className="h-4 w-4 text-gray-500" />
                <span className="text-gray-600">
                  Joined {formatDistanceToNow(joinedDate, { addSuffix: true })}
                </span>
              </div>
            </div>
            <div className="flex space-x-6 text-sm font-medium">
              <Link
                to={`/${npub}`}
                className="flex items-center space-x-1 text-gray-900 hover:text-blue-600 transition-colors duration-300 relative group"
              >
                <span>{posts.length}</span>
                <span className="text-gray-600">Posts</span>
                <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-blue-600 transition-all duration-300 group-hover:w-full" />
              </Link>
              <Link
                to={`/${npub}/following`}
                className="flex items-center space-x-1 text-gray-900 hover:text-blue-600 transition-colors duration-300 relative group"
              >
                <span>{followingCount}</span>
                <span className="text-gray-600">Following</span>
                <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-blue-600 transition-all duration-300 group-hover:w-full" />
              </Link>
              <Link
                to={`/${npub}/followers`}
                className="flex items-center space-x-1 text-gray-900 hover:text-blue-600 transition-colors duration-300 relative group"
              >
                <span>{followerCount}</span>
                <span className="text-gray-600">Followers</span>
                <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-blue-600 transition-all duration-300 group-hover:w-full" />
              </Link>
            </div>
            <Button
              variant="outline"
              onClick={() => setShowDetails(!showDetails)}
              className="mt-4 w-full md:w-auto bg-white hover:bg-gray-100 border-2 border-gray-300 transition-all duration-300 hover:shadow-md"
            >
              <QrCode className="h-4 w-4 mr-2" />
              {showDetails ? 'Hide Details' : 'Show Lightning & Pubkey'}
            </Button>
            <AnimatePresence>
              {showDetails && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.3 }}
                  className="mt-4 space-y-4 overflow-hidden"
                >
                  {(lud06 || lud16) && (
                    <Card className="bg-white/80 backdrop-blur-md border border-gray-200/50 p-4 rounded-xl shadow-sm hover:shadow-md transition-shadow">
                      <h3 className="text-sm font-medium text-gray-900">Lightning Address</h3>
                      <div className="flex items-center justify-between mt-2">
                        <p className="text-sm text-gray-600 break-all">{lud06 || lud16}</p>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyToClipboard(lud06 || lud16 || '', 'Lightning Address')}
                          className="text-gray-500 hover:text-gray-700"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                      <QRCodeSVG value={lud06 || lud16 || ''} size={128} className="mt-2 w-full" />
                    </Card>
                  )}
                  <Card className="bg-white/80 backdrop-blur-md border border-gray-200/50 p-4 rounded-xl shadow-sm hover:shadow-md transition-shadow">
                    <h3 className="text-sm font-medium text-gray-900">Public Key</h3>
                    <div className="flex items-center justify-between mt-2">
                      <p className="text-sm text-gray-600 break-all">{pubkey}</p>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyToClipboard(pubkey, 'Public Key')}
                        className="text-gray-500 hover:text-gray-700"
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                    <QRCodeSVG value={pubkey} size={128} className="mt-2 w-full" />
                  </Card>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </CardContent>
      </Card>
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-gray-900">Posts</h2>
        {posts.length === 0 ? (
          <Card className="border-dashed bg-card/50 backdrop-blur-sm">
            <CardContent className="py-12 px-8 text-center">
              <div className="max-w-sm mx-auto space-y-4">
                <Users className="h-12 w-12 mx-auto text-muted-foreground" />
                <p className="text-muted-foreground">
                  {isCurrentUser ? "You haven't posted anything yet." : "No posts found."}
                </p>
                {isCurrentUser && (
                  <Button className="bg-blue-600 text-white hover:bg-blue-700 transition-all duration-300 hover:shadow-md">
                    Create your first post
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {posts.map((post, index) => (
              <Post key={post.id} event={post} /> 
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const copyToClipboard = (text: string, label: string) => {
  navigator.clipboard.writeText(text).then(() => {
    toast({ title: `${label} copied to clipboard!`, description: text.substring(0, 20) + '...', duration: 2000 });
  }).catch(err => {
    toast({ title: 'Copy failed', description: err.message, variant: 'destructive' });
  });
};