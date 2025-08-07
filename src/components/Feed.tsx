import { useState, useEffect } from 'react';
import { useFeed } from '@/hooks/useFeed';
import { useTrending } from '@/hooks/useTrending';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { Post } from '@/components/Post';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { RelaySelector } from '@/components/RelaySelector';
import { RefreshCw, MessageSquare, Hash, AtSign } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { motion, AnimatePresence } from 'framer-motion';

export function Feed() {
  const { data: posts, isLoading: isFeedLoading, error: feedError, refetch, isFetching } = useFeed();
  const { data: trendingData, isLoading: isTrendingLoading, error: trendingError } = useTrending();
  const [newPostsCount, setNewPostsCount] = useState(0);
  const [lastPostId, setLastPostId] = useState<string | null>(null);

  useEffect(() => {
    if (posts && posts.length > 0) {
      const latestPostId = posts[0].id;
      if (lastPostId && latestPostId !== lastPostId) {
        const newPosts = posts.findIndex((post) => post.id === lastPostId);
        if (newPosts > 0) {
          setNewPostsCount(newPosts);
        }
      }
      if (!lastPostId) {
        setLastPostId(latestPostId);
      }
    }
  }, [posts, lastPostId]);

  const handleRefresh = () => {
    refetch();
    setNewPostsCount(0);
    if (posts && posts.length > 0) {
      setLastPostId(posts[0].id);
    }
  };

  // Animation variants
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.1 },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { type: 'spring', stiffness: 100, damping: 20 },
    },
  };

  const { topHashtags = [], topMentions = [] } = trendingData || {};

  const renderErrorState = (errorMessage: string) => (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="col-span-full max-w-3xl mx-auto"
    >
      <Card className="border-dashed border-2 border-gray-200 dark:border-gray-700 shadow-sm rounded-xl">
        <CardContent className="py-16 px-8 text-center">
          <div className="max-w-md mx-auto space-y-6">
            <motion.div
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ duration: 2, repeat: Infinity, repeatType: 'loop' }}
            >
              <MessageSquare className="mx-auto h-12 w-12 text-gray-400" />
            </motion.div>
            <p className="text-gray-600 dark:text-gray-300 text-lg">{errorMessage}</p>
            <RelaySelector className="w-full" />
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );

  if (isFeedLoading && isTrendingLoading) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <Skeleton className="h-8 w-32" />
              <div className="flex items-center space-x-3">
                <Skeleton className="h-8 w-20" />
                <Skeleton className="h-8 w-20" />
              </div>
            </div>
            {Array.from({ length: 5 }).map((_, i) => (
              <Card key={i} className="shadow-sm max-w-3xl mx-auto">
                <CardContent className="p-6">
                  <div className="flex items-start space-x-4">
                    <Skeleton className="h-12 w-12 rounded-full animate-pulse" />
                    <div className="space-y-3 flex-1">
                      <div className="flex items-center space-x-2">
                        <Skeleton className="h-5 w-28 animate-pulse" />
                        <Skeleton className="h-5 w-20 animate-pulse" />
                      </div>
                      <div className="space-y-2">
                        <Skeleton className="h-5 w-full animate-pulse" />
                        <Skeleton className="h-5 w-4/5 animate-pulse" />
                        <Skeleton className="h-5 w-3/5 animate-pulse" />
                      </div>
                      <div className="flex space-x-4 pt-3">
                        {Array.from({ length: 4 }).map((_, j) => (
                          <Skeleton key={j} className="h-9 w-20 animate-pulse" />
                        ))}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <Skeleton className="h-6 w-32" />
              </CardHeader>
              <CardContent className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-8" />
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <Skeleton className="h-6 w-32" />
              </CardHeader>
              <CardContent className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-8" />
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  if (feedError || trendingError) {
    return renderErrorState(
      feedError && trendingError
        ? 'Failed to load feed and trending content. Try another relay?'
        : feedError
        ? 'Failed to load posts. Try another relay?'
        : 'Failed to load trending content. Try another relay?'
    );
  }

  if (!posts || posts.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
        className="col-span-full max-w-3xl mx-auto"
      >
        <Card className="border-dashed border-2 border-gray-200 dark:border-gray-700 shadow-sm rounded-xl">
          <CardContent className="py-16 px-8 text-center">
            <div className="max-w-md mx-auto space-y-6">
              <motion.div
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ duration: 2, repeat: Infinity, repeatType: 'loop' }}
              >
                <MessageSquare className="mx-auto h-12 w-12 text-gray-400" />
              </motion.div>
              <p className="text-gray-600 dark:text-gray-300 text-lg">
                No posts yet. Be the first to share your thoughts!
              </p>
              <Button
                asChild
                className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1"
              >
                <a href="/compose">Compose</a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6 max-w-7xl mx-auto"
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Feed Content */}
        <motion.div
          variants={containerVariants}
          className="lg:col-span-2 space-y-6"
        >
          <div className="flex items-center justify-between">
            <motion.h2
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5 }}
              className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent"
            >
              Latest Posts
            </motion.h2>
            <div className="flex items-center space-x-3">
              <AnimatePresence>
                {newPostsCount > 0 && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ duration: 0.3 }}
                  >
                    <Button
                      variant="default"
                      size="sm"
                      onClick={handleRefresh}
                      className="bg-gradient-to-r from-green-500 to-blue-500 hover:from-green-600 hover:to-blue-600 shadow-md hover:shadow-lg transition-all duration-300 transform hover:-translate-y-1 animate-pulse"
                      aria-label="Load new posts"
                    >
                      {newPostsCount} new post{newPostsCount > 1 ? 's' : ''}
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={isFetching}
                className="shadow-sm hover:shadow-md transition-all duration-300 transform hover:-translate-y-1 border-gray-200 dark:border-gray-700"
                aria-label="Refresh feed"
              >
                <RefreshCw
                  className={`h-4 w-4 mr-2 transition-transform duration-500 ${
                    isFetching ? 'animate-spin' : ''
                  }`}
                />
                Refresh
              </Button>
            </div>
          </div>

          <div className="space-y-6 max-w-3xl mx-auto">
            {posts.map((post, index) => (
              <motion.div
                key={post.id}
                variants={itemVariants}
                className="transform hover:scale-[1.01] transition-transform duration-300"
              >
                <Post event={post} />
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Trending Sidebar (Right Side) */}
        <div className="space-y-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <Card className="shadow-sm hover:shadow-md transition-shadow duration-300 rounded-xl">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2 text-lg">
                  <Hash className="h-5 w-5 text-blue-500" />
                  <span>Trending Hashtags</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {topHashtags.length === 0 ? (
                  <p className="text-gray-500 dark:text-gray-400 text-sm">
                    No trending hashtags found
                  </p>
                ) : (
                  <div className="space-y-3">
                    {topHashtags.slice(0, 5).map(({ tag, count }, index) => (
                      <motion.div
                        key={tag}
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.3, delay: index * 0.1 }}
                        className="flex items-center justify-between"
                      >
                        <div className="flex items-center space-x-2">
                          <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
                            {index + 1}
                          </span>
                          <p
                            // to={`/hashtag/${tag}`}
                            className="font-medium text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            #{tag}
                          </p>
                        </div>
                        <Badge
                          variant="secondary"
                          className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-100 text-xs"
                        >
                          {count}
                        </Badge>
                      </motion.div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
          >
            <Card className="shadow-sm hover:shadow-md transition-shadow duration-300 rounded-xl">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2 text-lg">
                  <AtSign className="h-5 w-5 text-green-500" />
                  <span>Most Mentioned</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {topMentions.length === 0 ? (
                  <p className="text-gray-500 dark:text-gray-400 text-sm">
                    No mentions found
                  </p>
                ) : (
                  <div className="space-y-3">
                    {topMentions.slice(0, 5).map(({ pubkey, count }, index) => (
                      <MentionedUser
                        key={pubkey}
                        pubkey={pubkey}
                        count={count}
                        rank={index + 1}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}

function MentionedUser({ pubkey, count, rank }: { pubkey: string; count: number; rank: number }) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const displayName = metadata?.display_name || metadata?.name || genUserName(pubkey);
  const profileImage = metadata?.picture;
  const npub = nip19.npubEncode(pubkey);

  return (
    <motion.div
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay: (rank - 1) * 0.1 }}
      className="flex items-center justify-between"
    >
      <Link to={`/${npub}`} className="flex items-center space-x-2 hover:opacity-80">
        <span className="text-sm font-medium text-gray-500 dark:text-gray-400 w-4">
          {rank}
        </span>
        <Avatar className="h-6 w-6">
          <AvatarImage src={profileImage} alt={displayName} />
          <AvatarFallback className="text-xs">
            {displayName.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <span className="font-medium text-sm truncate max-w-[120px]">
          {displayName}
        </span>
      </Link>
      <Badge
        variant="secondary"
        className="bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-100 text-xs"
      >
        {count}
      </Badge>
    </motion.div>
  );
}