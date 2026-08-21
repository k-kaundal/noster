import React, { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Loader2, Upload, Zap } from 'lucide-react';
import { NSchema as n, type NostrMetadata } from '@nostrify/nostrify';
import { useUploadFile } from '@/hooks/useUploadFile';
import { useIdentity } from '@/hooks/useIdentity';
import { useAddressCheck } from '@/hooks/useAddressCheck';
import { useDebounce } from '@/hooks/useDebounce';


interface EditProfileFormProps {
  onSuccess?: () => void;
}

export const EditProfileForm: React.FC<EditProfileFormProps> = ({ onSuccess }) => {
  const { user, metadata } = useCurrentUser();
  const { mutateAsync: publishEvent, isPending } = useNostrPublish();
  const { mutateAsync: uploadFile, isPending: isUploading } = useUploadFile();
  const { toast } = useToast();

  // Initialize the form with default values
  const form = useForm<NostrMetadata>({
    resolver: zodResolver(n.metadata()),
    defaultValues: {
      name: '',
      display_name: '',
      about: '',
      picture: '',
      banner: '',
      website: '',
      nip05: '',
      lud16: '',
      bot: false,
    },
  });

  // Update form values when user data is loaded
  useEffect(() => {
    if (metadata) {
      form.reset({
        name: metadata.name || '',
        display_name: metadata.display_name || '',
        about: metadata.about || '',
        picture: metadata.picture || '',
        banner: metadata.banner || '',
        website: metadata.website || '',
        nip05: metadata.nip05 || '',
        lud16: metadata.lud16 || '',
        bot: metadata.bot || false,
      });
    }
  }, [metadata, form]);

  // Handle file uploads for profile picture and banner
  const uploadPicture = async (file: File, field: 'picture' | 'banner') => {
    try {
      // The first tuple in the array contains the URL
      const [[_, url]] = await uploadFile(file);
      form.setValue(field, url);
      toast({
        title: 'Uploaded',
        description: `Your ${field === 'picture' ? 'profile picture' : 'banner'} is ready — save to publish it.`,
      });
    } catch (error) {
      console.error(`Failed to upload ${field}:`, error);
      toast({
        title: 'Error',
        description: `Failed to upload ${field === 'picture' ? 'profile picture' : 'banner'}. Please try again.`,
        variant: 'destructive',
      });
    }
  };

  const onSubmit = async (values: NostrMetadata) => {
    if (!user) {
      toast({
        title: 'Error',
        description: 'You must be logged in to update your profile',
        variant: 'destructive',
      });
      return;
    }

    try {
      // Combine existing metadata with new values
      const data = { ...metadata, ...values };

      // Clean up empty values
      for (const key in data) {
        if (data[key] === '') {
          delete data[key];
        }
      }

      // Publish the metadata event (kind 0)
      await publishEvent({
        kind: 0,
        content: JSON.stringify(data),
      });

      /*
       * Deliberately not invalidated.
       *
       * `useNostrPublish` has already seeded the cache with the signed event,
       * which is the truth. Invalidating asks the relays — and they have not
       * indexed it yet, so they answer with the *previous* profile, which then
       * lands on top of the edit that was just made. That is the whole of "I
       * saved my profile and it changed back".
       *
       * `reconcileAuthor` now refuses an older event whatever asks for it, so
       * this is belt and braces rather than the only guard — but there is no
       * reason to spend a request to be told something staler than what is
       * already on screen. See `useAuthor`.
       */

      toast({
        title: 'Profile updated',
        description: 'Your changes are on the relays you write to.',
      });

      // Only now is there anything to close a dialog over. Firing this after
      // an image upload meant picking a photo dismissed the form before the
      // profile was ever saved.
      onSuccess?.();
    } catch (error) {
      console.error('Failed to update profile:', error);
      toast({
        title: 'Error',
        description: 'Failed to update your profile. Please try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Username</FormLabel>
              <FormControl>
                <Input placeholder="satoshi" {...field} value={field.value ?? ''} />
              </FormControl>
              <FormDescription>
                The short handle others see as @you.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="display_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Display name</FormLabel>
              <FormControl>
                <Input placeholder="Satoshi Nakamoto" {...field} value={field.value ?? ''} />
              </FormControl>
              <FormDescription>
                Shown in place of your username where there is room for it.
                Leave it blank to be known by your username alone.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="about"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Bio</FormLabel>
              <FormControl>
                <Textarea 
                  placeholder="Tell others about yourself" 
                  className="resize-none" 
                  {...field} 
                />
              </FormControl>
              <FormDescription>
                A short description about yourself.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <FormField
            control={form.control}
            name="picture"
            render={({ field }) => (
              <ImageUploadField
                field={field}
                label="Profile Picture"
                placeholder="https://example.com/profile.jpg"
                description="URL to your profile picture. You can upload an image or provide a URL."
                previewType="square"
                onUpload={(file) => uploadPicture(file, 'picture')}
              />
            )}
          />

          <FormField
            control={form.control}
            name="banner"
            render={({ field }) => (
              <ImageUploadField
                field={field}
                label="Banner Image"
                placeholder="https://example.com/banner.jpg"
                description="URL to a wide banner image for your profile. You can upload an image or provide a URL."
                previewType="wide"
                onUpload={(file) => uploadPicture(file, 'banner')}
              />
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <FormField
            control={form.control}
            name="website"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Website</FormLabel>
                <FormControl>
                  <Input placeholder="https://yourwebsite.com" {...field} />
                </FormControl>
                <FormDescription>
                  Your personal website or social media link.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="nip05"
            render={({ field }) => (
              <FormItem>
                <FormLabel>NIP-05 Identifier</FormLabel>
                <FormControl>
                  <Input placeholder="you@example.com" {...field} />
                </FormControl>
                <FormDescription>
                  Your verified Nostr identifier.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="lud16"
          render={({ field }) => (
            <LightningAddressField field={{
              value: field.value ?? '',
              onChange: field.onChange,
              name: field.name,
              onBlur: field.onBlur,
            }} />
          )}
        />

        <FormField
          control={form.control}
          name="bot"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <FormLabel className="text-base">Bot Account</FormLabel>
                <FormDescription>
                  Mark this account as automated or a bot.
                </FormDescription>
              </div>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
            </FormItem>
          )}
        />

        <Button 
          type="submit" 
          className="w-full md:w-auto" 
          disabled={isPending || isUploading}
        >
          {(isPending || isUploading) && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          Save Profile
        </Button>
      </form>
    </Form>
  );
};

// Reusable component for image upload fields
interface ImageUploadFieldProps {
  field: {
    value: string | undefined;
    onChange: (value: string) => void;
    name: string;
    onBlur: () => void;
  };
  label: string;
  placeholder: string;
  description: string;
  previewType: 'square' | 'wide';
  onUpload: (file: File) => void;
}

const ImageUploadField: React.FC<ImageUploadFieldProps> = ({
  field,
  label,
  placeholder,
  description,
  previewType,
  onUpload,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <FormItem>
      <FormLabel>{label}</FormLabel>
      <div className="flex flex-col gap-2">
        <FormControl>
          <Input
            placeholder={placeholder}
            name={field.name}
            value={field.value ?? ''}
            onChange={e => field.onChange(e.target.value)}
            onBlur={field.onBlur}
          />
        </FormControl>
        <div className="flex items-center gap-2">
          <input 
            type="file" 
            ref={fileInputRef}
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                onUpload(file);
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-4 w-4 mr-2" />
            Upload Image
          </Button>
          {field.value && (
            <div className={`h-10 ${previewType === 'square' ? 'w-10' : 'w-24'} rounded overflow-hidden`}>
              <img 
                src={field.value} 
                alt={`${label} preview`} 
                className="h-full w-full object-cover"
              />
            </div>
          )}
        </div>
      </div>
      <FormDescription>
        {description}
      </FormDescription>
      <FormMessage />
    </FormItem>
  );
};

/**
 * Where zaps go.
 *
 * Offered with a shortcut to the address this app issues, because the common
 * case is someone who has just claimed `name@nostrfeed.com` and has no idea it
 * does nothing until it reaches their profile. A profile without this field is
 * a profile nobody can zap.
 */
const LightningAddressField: React.FC<{
  field: {
    value: string;
    onChange: (value: string) => void;
    name: string;
    onBlur: () => void;
  };
}> = ({ field }) => {
  /*
   * The corrected name, not the label the pay link was found under. This
   * field offers to fill itself in, so reading the raw one would hand
   * somebody `luna@ln.nostrfeed.com` to publish when what they hold is
   * `luna@getzap.me`.
   */
  const { address } = useIdentity();
  const alreadySet = !!address && field.value === address;

  /**
   * Checked as they stop typing.
   *
   * This field takes any string, and a wrong one fails silently forever: the
   * zap button on every post keeps looking like it works, payers assume their
   * own wallet is broken, and the person being paid finds out weeks later.
   * `getalby.con` is indistinguishable from `getalby.com` by eye.
   */
  const debounced = useDebounce(field.value, 600);
  const check = useAddressCheck(debounced, debounced === field.value);

  return (
    <FormItem>
      <FormLabel>Lightning address</FormLabel>
      <FormControl>
        <Input
          placeholder="you@example.com"
          name={field.name}
          value={field.value}
          onChange={(event) => field.onChange(event.target.value)}
          onBlur={field.onBlur}
        />
      </FormControl>

      {address && !alreadySet && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-1"
          onClick={() => field.onChange(address)}
        >
          <Zap className="mr-2 h-3.5 w-3.5" />
          Use {address}
        </Button>
      )}

      {check.status === 'checking' && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Checking that address answers…
        </p>
      )}

      {check.status === 'unreachable' && (
        <p className="text-xs text-destructive">{check.reason}</p>
      )}

      {check.status === 'ok' && (
        <p className="text-xs text-success">
          {check.zaps
            ? 'That address answers and supports Nostr zaps.'
            : 'That address takes payments, but not Nostr zaps — zaps from other clients will fail.'}
        </p>
      )}

      <FormDescription>
        Zaps from any Nostr client are sent here. Without it, the zap button on
        your posts does nothing.
      </FormDescription>
      <FormMessage />
    </FormItem>
  );
};
