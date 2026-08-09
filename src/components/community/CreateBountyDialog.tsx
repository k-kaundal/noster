import { useState } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/**
 * Create Bounty Dialog: Post a new bounty for community.
 *
 * Fields:
 * - Title: "Build Rust CLI tool"
 * - Description: Full problem statement
 * - Reward: Amount in sats (deducted from treasury)
 * - Deadline: Days until submissions close
 */
export function CreateBountyDialog() {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    reward: '',
    deadline: '7', // days
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // TODO: Call API to create bounty
      // await publishBounty(formData)
      console.log('Bounty submitted:', formData);

      // Reset form and close dialog
      setFormData({ title: '', description: '', reward: '', deadline: '7' });
      setOpen(false);
    } catch (error) {
      console.error('Failed to create bounty:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Post Bounty
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-lg">🎯</span>
            Post a Bounty
          </DialogTitle>
          <DialogDescription>
            Fund a task for your community to solve. Cost is deducted from treasury.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="bounty-title" className="text-xs font-semibold uppercase tracking-wider">
              Title
            </Label>
            <Input
              id="bounty-title"
              name="title"
              placeholder="Build a Rust CLI tool"
              value={formData.title}
              onChange={handleChange}
              required
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="bounty-description" className="text-xs font-semibold uppercase tracking-wider">
              Description
            </Label>
            <Textarea
              id="bounty-description"
              name="description"
              placeholder="Detailed problem statement, requirements, deliverables..."
              value={formData.description}
              onChange={handleChange}
              className="min-h-[100px] resize-none"
              required
            />
          </div>

          {/* Reward */}
          <div className="space-y-2">
            <Label htmlFor="bounty-reward" className="text-xs font-semibold uppercase tracking-wider">
              Reward
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="bounty-reward"
                name="reward"
                type="number"
                placeholder="50000"
                value={formData.reward}
                onChange={handleChange}
                className="text-xl font-bold tabular-nums"
                required
              />
              <span className="text-sm text-muted-foreground">sats</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Will be deducted from treasury when posted
            </p>
          </div>

          {/* Deadline */}
          <div className="space-y-2">
            <Label htmlFor="bounty-deadline" className="text-xs font-semibold uppercase tracking-wider">
              Deadline
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="bounty-deadline"
                name="deadline"
                type="number"
                placeholder="7"
                value={formData.deadline}
                onChange={handleChange}
                className="text-xl font-bold"
                min="1"
                max="90"
                required
              />
              <span className="text-sm text-muted-foreground">days</span>
            </div>
          </div>

          {/* Submit Button */}
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isLoading ? 'Posting...' : 'Post Bounty'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
