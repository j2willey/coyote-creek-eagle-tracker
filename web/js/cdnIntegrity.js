// Subresource Integrity for every third-party script loaded from jsDelivr: the URL and its sha384 hash live together
// here, so a version bump needs a new hash. jsDelivr serves npm package files verbatim, so each hash is the sha384 of
// that file in the npm tarball:  openssl dgst -sha384 -binary <file> | openssl base64 -A
// test/cdnIntegrity.test.js checks the pdf-lib and pdfjs-dist hashes against node_modules (a version bump without a
// new hash fails `npm test`).
//
// Known gap: the pdf.js worker (`GlobalWorkerOptions.workerSrc`, pdf.worker.min.js) is started by pdf.js as a Web
// Worker, and the Google Fonts stylesheet is generated per request; neither can carry SRI.

export const CDN_SCRIPTS = {
  pdfLib: {
    url: 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js',
    integrity: 'sha384-weMABwrltA6jWR8DDe9Jp5blk+tZQh7ugpCsF3JwSA53WZM9/14PjS5LAJNHNjAI'
  },
  pdfJs: {
    url: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
    integrity: 'sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e'
  },
  piexif: {
    url: 'https://cdn.jsdelivr.net/npm/piexifjs@1.0.6/piexif.js',
    integrity: 'sha384-yk/k1j9hKtYh4LJRX0d6o3pO9c8h4lp2IMnWdamQhThRA2Z9B0YNDeGKyDmPXnnJ'
  },
  heic2any: {
    url: 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js',
    integrity: 'sha384-OTofQ0MEeiSgh62havBcemCIK0gqj809wX6UA0uPISNMRnR6NZyCdGzX3SbLrgwL'
  },
  fullCalendar: {
    url: 'https://cdn.jsdelivr.net/npm/fullcalendar@6.1.15/index.global.min.js',
    integrity: 'sha384-B1OFx8Gy9GjPu8UbUyXbGQpzll9ubAUQ9agInFJ8NnD7nYG1u/CLR+Sqr5yifl4q'
  }
};
