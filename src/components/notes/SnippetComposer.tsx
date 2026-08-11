import { useState } from 'react';
import { FileCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import {
  COMMON_LICENSES,
  SNIPPET_KIND,
  SNIPPET_LANGUAGES,
  buildSnippetTags,
  extensionFor,
} from '@/lib/nipc0';
import type { ReactNode } from 'react';

/**
 * Publishing a kind 1337.
 *
 * The code goes in a plain textarea rather than an editor: the content is
 * published verbatim, and anything that reformats, re-indents or trims it on
 * the way through would change what somebody wrote before it was signed.
 */
export function SnippetComposer({ children }: { children?: ReactNode }) {
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [language, setLanguage] = useState('javascript');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [runtime, setRuntime] = useState('');
  const [license, setLicense] = useState('MIT');
  const [dependencies, setDependencies] = useState('');
  const [repo, setRepo] = useState('');
  const [isPublishing, setPublishing] = useState(false);

  if (!user) return null;

  const publish = async () => {
    if (!code.trim()) return;
    setPublishing(true);

    try {
      await createEvent({
        kind: SNIPPET_KIND,
        // Untrimmed: leading indentation is part of a snippet
        content: code,
        tags: buildSnippetTags({
          code,
          language,
          name,
          /**
           * Derived from the language when the filename does not carry one,
           * so the download button produces a file that opens in an editor
           * rather than one the system has no idea what to do with.
           */
          extension: name.includes('.')
            ? name.split('.').pop()
            : extensionFor(language),
          description,
          runtime,
          licenses: license ? [{ id: license }] : [],
          dependencies: dependencies
            .split(/[,\n]/)
            .map((entry) => entry.trim())
            .filter(Boolean),
          repo: repo.trim() ? { url: repo.trim() } : undefined,
        }),
      });

      toast({ title: 'Snippet published' });
      setOpen(false);
      setCode('');
      setName('');
      setDescription('');
    } catch (error) {
      toast({
        title: 'Could not publish that snippet',
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setPublishing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children ?? (
          <Button variant="outline" size="sm" className="gap-1.5">
            <FileCode className="h-4 w-4" />
            Share code
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Share a code snippet</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="snippet-code">Code</Label>
            <Textarea
              id="snippet-code"
              value={code}
              onChange={(changed) => setCode(changed.target.value)}
              placeholder="Paste your code here"
              rows={12}
              className="font-mono text-[13px]"
              spellCheck={false}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="snippet-language">Language</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger id="snippet-language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SNIPPET_LANGUAGES.map((entry) => (
                    <SelectItem key={entry} value={entry}>
                      {entry}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="snippet-name">Filename</Label>
              <Input
                id="snippet-name"
                value={name}
                onChange={(changed) => setName(changed.target.value)}
                placeholder={`hello-world.${extensionFor(language) ?? 'txt'}`}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="snippet-description">Description</Label>
            <Input
              id="snippet-description"
              value={description}
              onChange={(changed) => setDescription(changed.target.value)}
              placeholder="What does it do?"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="snippet-runtime">Runtime</Label>
              <Input
                id="snippet-runtime"
                value={runtime}
                onChange={(changed) => setRuntime(changed.target.value)}
                placeholder="node v18.15.0"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="snippet-license">Licence</Label>
              <Select value={license} onValueChange={setLicense}>
                <SelectTrigger id="snippet-license">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMMON_LICENSES.map((entry) => (
                    <SelectItem key={entry} value={entry}>
                      {entry}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="snippet-deps">Dependencies</Label>
              <Input
                id="snippet-deps"
                value={dependencies}
                onChange={(changed) => setDependencies(changed.target.value)}
                placeholder="react, zod"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="snippet-repo">Repository</Label>
              <Input
                id="snippet-repo"
                value={repo}
                onChange={(changed) => setRepo(changed.target.value)}
                placeholder="https://github.com/you/project"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isPublishing}
          >
            Cancel
          </Button>
          <Button onClick={publish} disabled={isPublishing || !code.trim()}>
            {isPublishing ? 'Publishing…' : 'Publish snippet'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
