import { useState } from 'react';
import { Plus, Loader2, Gift } from 'lucide-react';
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
 * Create Sats Drop Dialog: Distribute sats to community via LNURL-withdraw.
 *
 * Fields:
 * - Title: "Welcome gift", "Milestone celebration", etc.
 * - Description: Optional reason
 * - Amount per claim: How much each person gets
 * - Total budget: Total sats to distribute
 * - Duration: How long drop lasts
 */
export function CreateSatsDropDialog() {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    amountPerClaim: '',
    totalBudget: '',
    durationDays: '7',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // TODO: Call API to create sats drop
      // await createSatsDrop(formData)
      console.log('Sats drop created:', formData);

      // Reset form and close dialog
      setFormData({
        title: '',
        description: '',
        amountPerClaim: '',
        totalBudget: '',
        durationDays: '7',
      });
      setOpen(false);
    } catch (error) {
      console.error('Failed to create sats drop:', error);
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

  const totalBudget = Number(formData.totalBudget) || 0;
  const amountPerClaim = Number(formData.amountPerClaim) || 1;
  const estimatedClaims = amountPerClaim > 0 ? Math.floor(totalBudget / amountPerClaim) : 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Create Drop
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gift className="h-5 w-5" />
            Create Sats Drop
          </DialogTitle>
          <DialogDescription>
            Distribute sats to your community. Each person can claim once.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="drop-title" className="text-xs font-semibold uppercase tracking-wider">
              Title
            </Label>
            <Input
              id="drop-title"
              name="title"
              placeholder="Welcome to our community!"
              value={formData.title}
              onChange={handleChange}
              required
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="drop-description" className="text-xs font-semibold uppercase tracking-wider">
              Description (optional)
            </Label>
            <Textarea
              id="drop-description"
              name="description"
              placeholder="Why are you doing this drop?"
              value={formData.description}
              onChange={handleChange}
              className="min-h-[60px] resize-none"
            />
          </div>

          {/* Amount Per Claim */}
          <div className="space-y-2">
            <Label htmlFor="drop-amount" className="text-xs font-semibold uppercase tracking-wider">
              Per Claim
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="drop-amount"
                name="amountPerClaim"
                type="number"
                placeholder="1000"
                value={formData.amountPerClaim}
                onChange={handleChange}
                className="font-bold"
                required
              />
              <span className="text-sm text-muted-foreground">sats</span>
            </div>
          </div>

          {/* Total Budget */}
          <div className="space-y-2">
            <Label htmlFor="drop-budget" className="text-xs font-semibold uppercase tracking-wider">
              Total Budget
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="drop-budget"
                name="totalBudget"
                type="number"
                placeholder="100000"
                value={formData.totalBudget}
                onChange={handleChange}
                className="font-bold"
                required
              />
              <span className="text-sm text-muted-foreground">sats</span>
            </div>
          </div>

          {/* Duration */}
          <div className="space-y-2">
            <Label htmlFor="drop-duration" className="text-xs font-semibold uppercase tracking-wider">
              Duration
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="drop-duration"
                name="durationDays"
                type="number"
                placeholder="7"
                value={formData.durationDays}
                onChange={handleChange}
                className="font-bold"
                min="1"
                max="90"
                required
              />
              <span className="text-sm text-muted-foreground">days</span>
            </div>
          </div>

          {/* Summary */}
          {amountPerClaim > 0 && totalBudget > 0 && (
            <div className="rounded-lg bg-muted/50 p-3 space-y-1 text-sm">
              <p className="text-xs font-semibold text-muted-foreground">Summary</p>
              <div className="flex justify-between">
                <span>Estimated claims:</span>
                <span className="font-medium">{estimatedClaims} people</span>
              </div>
              <div className="flex justify-between">
                <span>Duration:</span>
                <span className="font-medium">{formData.durationDays} days</span>
              </div>
            </div>
          )}

          {/* Submit Button */}
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isLoading ? 'Creating...' : 'Create Drop'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
