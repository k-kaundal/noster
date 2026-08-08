import { useMutation } from '@tanstack/react-query';
import { BlossomUploader } from '@nostrify/nostrify/uploaders';

import { useCurrentUser } from './useCurrentUser';
import { describeUploadFailure, uploadServers } from '@/lib/uploadServers';

/**
 * Uploads a file, trying each configured server in turn.
 *
 * A single server was a single point of failure: when it was down or full,
 * every upload in the app failed with no recourse. Blossom addresses files by
 * their hash, so the servers are interchangeable — the first that accepts it
 * wins, and the others cost nothing until they are needed.
 */
export function useUploadFile() {
  const { user } = useCurrentUser();

  return useMutation({
    mutationFn: async (file: File) => {
      if (!user) {
        throw new Error('Must be logged in to upload files');
      }

      const servers = uploadServers();
      const failures: { label: string; message: string }[] = [];

      for (const server of servers) {
        try {
          const uploader = new BlossomUploader({
            servers: [server.url],
            signer: user.signer,
          });

          return await uploader.upload(file);
        } catch (error) {
          failures.push({
            label: server.label,
            message: (error as Error)?.message || 'unknown error',
          });
        }
      }

      throw new Error(describeUploadFailure(failures));
    },
  });
}
