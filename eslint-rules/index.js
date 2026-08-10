import noInlineScript from './no-inline-script.js';
import noPlaceholderComments from './no-placeholder-comments.js';
import noUnsignedPublish from './no-unsigned-publish.js';
import requireWebmanifest from './require-webmanifest.js';

export default {
  rules: {
    'no-inline-script': noInlineScript,
    'no-placeholder-comments': noPlaceholderComments,
    'no-unsigned-publish': noUnsignedPublish,
    'require-webmanifest': requireWebmanifest,
  },
};