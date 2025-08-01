import { useState } from 'react';
import { useSearch } from '@/hooks/useSearch';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { Post } from '@/components/Post';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Search, User, FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';

interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SearchDialog({ open, onOpenChange }: SearchDialogProps) {
  const [query, setQuery] = useState('');
  const { data: searchResults, isLoading } = useSearch(query);

  const handleClose = () => {
    setQuery('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Search className="h-5 w-5" />
            <span>Search Nostr</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-hidden">
          <Input
            placeholder="Search for posts, people, or topics..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full"
            autoFocus
          />

          {isLoading && query.length >= 2 && (
            <div className="flex items-center justify-center py-8">
              <LoadingSpinner />
            </div>
          )}

          {searchResults && query.length >= 2 && !isLoading && (
            <div className="space-y-6 overflow-y-auto flex-1">
              {/* Profiles */}
              {searchResults.profiles.length > 0 && (
                <div className="space-y-3">
                  <h3 className="font-semibold flex items-center space-x-2">
                    <User className="h-4 w-4" />
                    <span>People</span>
                  </h3>
                  <div className="space-y-2">
                    {searchResults.profiles.map((profile) => (
                      <SearchProfileResult
                        key={profile.id}
                        profile={profile}
                        onClose={handleClose}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Posts */}
              {searchResults.posts.length > 0 && (
                <div className="space-y-3">
                  <h3 className="font-semibold flex items-center space-x-2">
                    <FileText className="h-4 w-4" />
                    <span>Posts</span>
                  </h3>
                  <div className="space-y-4">
                    {searchResults.posts.map((post) => (
                      <div key={post.id} onClick={handleClose}>
                        <Post event={post} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {searchResults.posts.length === 0 && searchResults.profiles.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  No results found for "{query}"
                </div>
              )}
            </div>
          )}

          {query.length > 0 && query.length < 2 && (
            <div className="text-center py-8 text-muted-foreground">
              Type at least 2 characters to search
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SearchProfileResult({ profile, onClose }: { profile: { id: string; pubkey: string; content: string }; onClose: () => void }) {
  const author = useAuthor(profile.pubkey);
  const metadata = author.data?.metadata;
  const displayName = metadata?.display_name || metadata?.name || genUserName(profile.pubkey);
  const profileImage = metadata?.picture;
  const bio = metadata?.about;
  const npub = nip19.npubEncode(profile.pubkey);

  return (
    <Link
      to={`/${npub}`}
      onClick={onClose}
      className="flex items-start space-x-3 p-3 rounded-lg hover:bg-muted/50 transition-colors"
    >
      <Avatar className="h-10 w-10">
        <AvatarImage src={profileImage} alt={displayName} />
        <AvatarFallback>{displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-center space-x-2">
          <p className="font-medium truncate">{displayName}</p>
          {metadata?.nip05 && (
            <Badge variant="secondary" className="text-xs">
              ✓
            </Badge>
          )}
        </div>
        {bio && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {bio}
          </p>
        )}
      </div>
    </Link>
  );
}