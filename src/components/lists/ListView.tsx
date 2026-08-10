import { useState } from 'react';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { List as ListIcon, Pencil, Trash2, UserPlus, Users } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FollowButton } from '@/components/FollowButton';
import { ListEditor } from '@/components/lists/ListEditor';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useDeleteList } from '@/hooks/useLists';
import { useFollows } from '@/hooks/useFollows';
import { useToast } from '@/hooks/useToast';
import { genUserName } from '@/lib/genUserName';
import { STARTER_PACK_KIND, type PeopleList } from '@/lib/lists';
import { timeAgo } from '@/lib/time';

/**
 * A list of people, opened.
 *
 * The point of a list is the people in it, so they are the page — everything
 * else is a header above them. "Follow everyone" is offered because that is
 * what a starter pack is for, and doing it one row at a time is the thing
 * people came here to avoid.
 */
export function ListView({ list }: { list: PeopleList }) {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const { mutateAsync: deleteList, isPending: isDeleting } = useDeleteList();
  const [editing, setEditing] = useState(false);

  const isMine = user?.pubkey === list.author;

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        {list.image && (
          <img
            src={list.image}
            alt=""
            className="h-32 w-full object-cover sm:h-40"
            loading="lazy"
          />
        )}

        <CardContent className="space-y-4 pt-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <ListIcon className="h-4 w-4 shrink-0 text-primary" />
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {list.kind === STARTER_PACK_KIND
                    ? 'Starter pack'
                    : 'Follow set'}
                </span>
              </div>

              <h1 className="mt-1 text-2xl font-bold tracking-tight">
                {list.title}
              </h1>

              {list.description && (
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {list.description}
                </p>
              )}
            </div>

            {isMine && (
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setEditing(true)}
                  aria-label="Edit this list"
                >
                  <Pencil className="h-4 w-4" />
                </Button>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Delete this list"
                      disabled={isDeleting}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete "{list.title}"?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This asks your relays to drop it. Deletion on Nostr is a
                        request — a relay that ignores it will keep serving the
                        list, and anyone who already has it keeps their copy.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep it</AlertDialogCancel>
                      <AlertDialogAction onClick={() => deleteList(list)}>
                        Request deletion
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <Curator pubkey={list.author} at={list.createdAt} />
            <FollowEveryone people={list.people} />
          </div>
        </CardContent>
      </Card>

      {list.people.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center">
            <Users className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {isMine
                ? "This list is empty. Add the people who belong in it."
                : 'This list has nobody in it yet.'}
            </p>
            {isMine && (
              <Button
                className="mt-4"
                size="sm"
                onClick={() => setEditing(true)}
              >
                <UserPlus className="mr-2 h-4 w-4" />
                Add people
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="divide-y p-0">
            {list.people.map((pubkey) => (
              <Member key={pubkey} pubkey={pubkey} />
            ))}
          </CardContent>
        </Card>
      )}

      {editing && (
        <ListEditor
          open={editing}
          onOpenChange={setEditing}
          existing={list}
          onSaved={() =>
            toast({
              title: 'Saved',
              description: 'Your changes are on their way to your relays.',
            })
          }
        />
      )}
    </div>
  );
}

function Curator({ pubkey, at }: { pubkey: string; at: number }) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const name = metadata?.display_name || metadata?.name || genUserName(pubkey);

  return (
    <Link
      to={`/${nip19.npubEncode(pubkey)}`}
      className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
    >
      <Avatar className="h-6 w-6 shrink-0">
        <AvatarImage src={metadata?.picture} alt="" />
        <AvatarFallback className="text-[10px]">
          {name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="truncate">
        by {name} · {timeAgo(at * 1000)}
      </span>
    </Link>
  );
}

/**
 * Follows everyone who isn't already followed.
 *
 * Sequential rather than parallel: each follow republishes the whole contact
 * list, and firing twenty at once means twenty revisions of kind 3 racing each
 * other, with the last to land deciding who you follow.
 */
function FollowEveryone({ people }: { people: string[] }) {
  const { user } = useCurrentUser();
  const { followingList, follow } = useFollows(user?.pubkey || '');
  const { toast } = useToast();
  const [running, setRunning] = useState(false);

  if (!user || !people.length) return null;

  const known = new Set(
    followingList.map((entry: { pubkey: string }) => entry.pubkey)
  );
  const missing = people.filter(
    (pubkey) => pubkey !== user.pubkey && !known.has(pubkey)
  );

  if (!missing.length) {
    return (
      <span className="text-xs text-muted-foreground">
        You follow everyone here
      </span>
    );
  }

  const followAll = async () => {
    setRunning(true);

    try {
      for (const pubkey of missing) {
        await follow(pubkey);
      }

      toast({
        title: 'Followed',
        description: `Added ${missing.length} ${missing.length === 1 ? 'person' : 'people'} to your follows.`,
      });
    } catch {
      // Each follow reports its own failure; stopping here leaves the ones
      // that already went through in place rather than rolling them back
    } finally {
      setRunning(false);
    }
  };

  return (
    <Button size="sm" onClick={followAll} disabled={running}>
      <UserPlus className="mr-2 h-4 w-4" />
      {running ? 'Following…' : `Follow all ${missing.length}`}
    </Button>
  );
}

function Member({ pubkey }: { pubkey: string }) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const name = metadata?.display_name || metadata?.name || genUserName(pubkey);

  return (
    <div className="flex items-center gap-3 p-3 sm:p-4">
      <Link to={`/${nip19.npubEncode(pubkey)}`} className="shrink-0">
        <Avatar className="h-10 w-10">
          <AvatarImage src={metadata?.picture} alt="" />
          <AvatarFallback>{name.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
      </Link>

      <div className="min-w-0 flex-1">
        <Link
          to={`/${nip19.npubEncode(pubkey)}`}
          className="block truncate font-medium hover:underline"
        >
          {name}
        </Link>
        {metadata?.nip05 && (
          <p className="truncate text-xs text-muted-foreground">
            {metadata.nip05}
          </p>
        )}
        {!metadata?.nip05 && metadata?.about && (
          <p className="truncate text-xs text-muted-foreground">
            {metadata.about}
          </p>
        )}
      </div>

      <FollowButton pubkey={pubkey} className="shrink-0" />
    </div>
  );
}
