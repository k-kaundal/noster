import { useState } from 'react';
import { Plus, Loader2, Code } from 'lucide-react';
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
import { Badge } from '@/components/ui/badge';

/**
 * Create Mini App Dialog: Submit a mini app to the extension ecosystem.
 *
 * Fields:
 * - Name: App name
 * - Description: What the app does
 * - Category: Tools, Games, Utilities, etc.
 * - URL: Where the app is hosted
 * - Required Permissions: What data/features it needs
 */
export function CreateMiniAppDialog() {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: 'Tools',
    url: '',
    permissions: [] as string[],
  });
  const [newPermission, setNewPermission] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // TODO: Call API to create mini app
      // await createMiniApp(formData)
      console.log('Mini app submitted:', formData);

      // Reset form and close dialog
      setFormData({
        name: '',
        description: '',
        category: 'Tools',
        url: '',
        permissions: [],
      });
      setNewPermission('');
      setOpen(false);
    } catch (error) {
      console.error('Failed to create mini app:', error);
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

  const handleAddPermission = () => {
    if (newPermission.trim() && !formData.permissions.includes(newPermission)) {
      setFormData((prev) => ({
        ...prev,
        permissions: [...prev.permissions, newPermission.trim()],
      }));
      setNewPermission('');
    }
  };

  const handleRemovePermission = (permission: string) => {
    setFormData((prev) => ({
      ...prev,
      permissions: prev.permissions.filter((p) => p !== permission),
    }));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Submit App
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Code className="h-5 w-5" />
            Submit Mini App
          </DialogTitle>
          <DialogDescription>
            Share your app with the community. It will be reviewed before publishing.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="app-name" className="text-xs font-semibold uppercase tracking-wider">
              App Name
            </Label>
            <Input
              id="app-name"
              name="name"
              placeholder="My Awesome App"
              value={formData.name}
              onChange={handleChange}
              required
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="app-description" className="text-xs font-semibold uppercase tracking-wider">
              Description
            </Label>
            <Textarea
              id="app-description"
              name="description"
              placeholder="What does your app do?"
              value={formData.description}
              onChange={handleChange}
              className="min-h-[60px] resize-none"
              required
            />
          </div>

          {/* Category */}
          <div className="space-y-2">
            <Label htmlFor="app-category" className="text-xs font-semibold uppercase tracking-wider">
              Category
            </Label>
            <select
              id="app-category"
              name="category"
              value={formData.category}
              onChange={handleChange}
              className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
            >
              <option>Tools</option>
              <option>Games</option>
              <option>Utilities</option>
              <option>Finance</option>
              <option>Social</option>
              <option>Other</option>
            </select>
          </div>

          {/* URL */}
          <div className="space-y-2">
            <Label htmlFor="app-url" className="text-xs font-semibold uppercase tracking-wider">
              App URL
            </Label>
            <Input
              id="app-url"
              name="url"
              type="url"
              placeholder="https://myapp.example.com"
              value={formData.url}
              onChange={handleChange}
              required
            />
          </div>

          {/* Permissions */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider">
              Required Permissions
            </Label>
            <div className="flex gap-2">
              <Input
                placeholder="e.g., read:profile, write:notes"
                value={newPermission}
                onChange={(e) => setNewPermission(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddPermission();
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddPermission}
              >
                Add
              </Button>
            </div>
            {formData.permissions.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {formData.permissions.map((permission) => (
                  <Badge
                    key={permission}
                    variant="secondary"
                    className="cursor-pointer"
                    onClick={() => handleRemovePermission(permission)}
                  >
                    {permission} ✕
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Submit Button */}
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isLoading ? 'Submitting...' : 'Submit for Review'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
