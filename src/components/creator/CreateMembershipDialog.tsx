import { useState } from 'react';
import { Plus, Loader2, X } from 'lucide-react';
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
 * Create Membership Dialog: Set up recurring membership tier.
 *
 * Fields:
 * - Name: "Supporter", "Premium", etc.
 * - Description: What the membership is about
 * - Price: Amount in sats
 * - Interval: day, week, month, year
 * - Benefits: List of included benefits
 */
export function CreateMembershipDialog() {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: '',
    interval: 'month' as 'day' | 'week' | 'month' | 'year',
    benefits: [''],
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // TODO: Call API to create membership
      // await publishMembership(formData)
      console.log('Membership created:', formData);

      // Reset form and close dialog
      setFormData({
        name: '',
        description: '',
        price: '',
        interval: 'month',
        benefits: [''],
      });
      setOpen(false);
    } catch (error) {
      console.error('Failed to create membership:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleBenefitChange = (index: number, value: string) => {
    const newBenefits = [...formData.benefits];
    newBenefits[index] = value;
    setFormData((prev) => ({ ...prev, benefits: newBenefits }));
  };

  const addBenefit = () => {
    setFormData((prev) => ({ ...prev, benefits: [...prev.benefits, ''] }));
  };

  const removeBenefit = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      benefits: prev.benefits.filter((_, i) => i !== index),
    }));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Create Membership
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-lg">👥</span>
            Create Membership Tier
          </DialogTitle>
          <DialogDescription>
            Set up recurring payments. Subscribers renew automatically.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="membership-name" className="text-xs font-semibold uppercase tracking-wider">
              Tier Name
            </Label>
            <Input
              id="membership-name"
              name="name"
              placeholder="Premium Supporter"
              value={formData.name}
              onChange={handleChange}
              required
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="membership-description" className="text-xs font-semibold uppercase tracking-wider">
              Description
            </Label>
            <Textarea
              id="membership-description"
              name="description"
              placeholder="What do members get? Why join?"
              value={formData.description}
              onChange={handleChange}
              className="min-h-[80px] resize-none"
              required
            />
          </div>

          {/* Price & Interval */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="membership-price" className="text-xs font-semibold uppercase tracking-wider">
                Price
              </Label>
              <div className="flex items-center gap-1">
                <Input
                  id="membership-price"
                  name="price"
                  type="number"
                  placeholder="5000"
                  value={formData.price}
                  onChange={handleChange}
                  className="font-bold"
                  required
                />
                <span className="text-xs text-muted-foreground shrink-0">sats</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="membership-interval" className="text-xs font-semibold uppercase tracking-wider">
                Per
              </Label>
              <select
                id="membership-interval"
                name="interval"
                value={formData.interval}
                onChange={handleChange}
                className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm font-medium"
              >
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
                <option value="year">Year</option>
              </select>
            </div>
          </div>

          {/* Benefits */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold uppercase tracking-wider">
                Benefits
              </Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={addBenefit}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-2">
              {formData.benefits.map((benefit, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    placeholder="Exclusive content"
                    value={benefit}
                    onChange={(e) => handleBenefitChange(index, e.target.value)}
                    className="text-sm"
                  />
                  {formData.benefits.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeBenefit(index)}
                      className="text-destructive"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Submit Button */}
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isLoading ? 'Creating...' : 'Create Membership'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
