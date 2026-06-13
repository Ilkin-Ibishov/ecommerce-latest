# Requirements Document

## Introduction

Transform the product image system from a single-image external-URL approach into a professional multi-image management system. The system introduces intelligent image sourcing (text search, barcode lookup, URL paste, file upload), on-the-fly resizing via the wsrv.nl proxy service, and a unified admin UI for managing up to 5 images per product. The storefront gains a full image gallery with thumbnail navigation and swipe support.

## Glossary

- **Image_Proxy**: The wsrv.nl service used to resize, convert, and cache product images on-the-fly via URL parameters
- **Product_Image**: A record in the `product_images` table linking a URL, alt text, and sort order to a product
- **Image_Source**: The method used to obtain an image URL — one of: search, barcode, paste, or upload
- **Catalog_Card**: The product thumbnail shown on listing pages (home, category, search results)
- **Product_Gallery**: The image carousel/gallery displayed on the product detail page
- **Admin_Image_Panel**: The admin UI section for managing product images across all sourcing methods
- **Barcode_API**: The UPCitemdb.com free API used for product lookup by EAN/UPC code (100 requests/day limit)
- **Image_Search_Service**: The backend service that scrapes Google Images for candidate product photos
- **Asset_Uploader**: The existing server module (`asset-uploader.ts`) that validates and uploads files to Supabase Storage
- **Sort_Order**: An integer field determining the display sequence of images; sort_order 0 is the primary/thumbnail image

## Requirements

### Requirement 1: Image Proxy URL Generation

**User Story:** As a developer, I want all product images rendered through the wsrv.nl proxy, so that images are automatically resized, converted to WebP, and cached on a CDN without storing multiple sizes.

#### Acceptance Criteria

1. WHEN a Catalog_Card renders a Product_Image, THE Image_Proxy SHALL generate a URL with width=300, height=300, format=webp, and quality=80 parameters
2. WHEN a Product_Gallery renders a Product_Image as the main image, THE Image_Proxy SHALL generate a URL with width=1000, height=1000, format=webp, and quality=85 parameters
3. THE Image_Proxy URL generator SHALL accept a raw image URL and a size preset and return the proxied URL in the format `https://wsrv.nl/?url={encoded_url}&w={width}&h={height}&output=webp&q={quality}&fit=cover`
4. FOR ALL valid image URLs, generating a proxy URL and extracting the original URL parameter SHALL produce the original URL (round-trip property)
5. WHEN the raw image URL contains query parameters, THE Image_Proxy SHALL properly encode the URL to avoid parameter collision

### Requirement 2: Image Proxy Fallback

**User Story:** As a user, I want images to still display when wsrv.nl is unavailable, so that the shopping experience is not broken by a third-party service outage.

#### Acceptance Criteria

1. IF the Image_Proxy returns an HTTP error or times out after 5 seconds, THEN THE storefront component SHALL fall back to rendering the raw image URL directly
2. IF the Image_Proxy fails for a Catalog_Card, THEN THE Catalog_Card SHALL display the raw URL image without WebP conversion
3. IF the Image_Proxy fails for a Product_Gallery image, THEN THE Product_Gallery SHALL display the raw URL image without resizing

### Requirement 3: Image Search Sourcing

**User Story:** As an admin, I want to search for product images by name, so that I can quickly find and attach relevant images without leaving the admin panel.

#### Acceptance Criteria

1. WHEN the admin submits a text query in the Admin_Image_Panel search field, THE Image_Search_Service SHALL return between 0 and 20 candidate image URLs
2. WHEN search results are returned, THE Admin_Image_Panel SHALL display the candidate images in a selectable grid with visual previews
3. WHEN the admin selects one or more candidate images (up to the remaining image slot limit), THE Admin_Image_Panel SHALL add the selected URLs as Product_Image records
4. IF the Image_Search_Service returns zero results, THEN THE Admin_Image_Panel SHALL display a message indicating no images were found
5. IF the Image_Search_Service encounters an error, THEN THE Admin_Image_Panel SHALL display an error message and allow the admin to retry

### Requirement 4: Barcode Lookup Sourcing

**User Story:** As an admin, I want to look up product images by EAN/UPC barcode, so that I can quickly enrich product listings with manufacturer images.

#### Acceptance Criteria

1. WHEN the admin enters an EAN or UPC barcode number in the Admin_Image_Panel, THE Barcode_API SHALL be queried for product information and associated images
2. WHEN the Barcode_API returns images, THE Admin_Image_Panel SHALL display them in a selectable grid
3. WHEN the admin selects barcode images, THE Admin_Image_Panel SHALL add the selected URLs as Product_Image records
4. IF the Barcode_API returns no images for the barcode, THEN THE Admin_Image_Panel SHALL display a message indicating no images were found for that barcode
5. IF the Barcode_API daily limit (100 requests) has been exceeded, THEN THE API server SHALL return a rate-limit error and THE Admin_Image_Panel SHALL inform the admin to try again tomorrow
6. IF the barcode format is invalid (not a valid EAN-8, EAN-13, UPC-A, or UPC-E), THEN THE Admin_Image_Panel SHALL display a validation error before making any API call

### Requirement 5: URL Paste Sourcing

**User Story:** As an admin, I want to paste an image URL directly, so that I can add images from any source without restriction.

#### Acceptance Criteria

1. WHEN the admin pastes a URL in the Admin_Image_Panel URL input field, THE Admin_Image_Panel SHALL display a preview of the image loaded from that URL
2. WHEN the admin confirms the previewed image, THE Admin_Image_Panel SHALL add the URL as a Product_Image record
3. IF the pasted URL does not resolve to a valid image (HTTP error or non-image content-type), THEN THE Admin_Image_Panel SHALL display an error indicating the URL is not a valid image

### Requirement 6: File Upload Sourcing

**User Story:** As an admin, I want to upload image files from my computer, so that I can use my own product photos without relying on external URLs.

#### Acceptance Criteria

1. WHEN the admin selects or drops image files in the Admin_Image_Panel upload area, THE Asset_Uploader SHALL validate and upload the files to the Supabase Storage `site-assets` bucket under the `products/` folder
2. WHEN the upload completes successfully, THE Admin_Image_Panel SHALL add the returned Supabase CDN URL as a Product_Image record
3. THE Asset_Uploader SHALL accept files of type image/jpeg, image/png, image/webp, and image/avif for product image uploads
4. THE Asset_Uploader SHALL reject files larger than 5 MB for product image uploads
5. IF an upload fails, THEN THE Admin_Image_Panel SHALL display an error message with the failure reason

### Requirement 7: Maximum Images Constraint

**User Story:** As a product manager, I want to limit products to a maximum of 5 images, so that the UX remains clean and page performance stays optimal.

#### Acceptance Criteria

1. THE API server SHALL reject requests to add a Product_Image when the product already has 5 images, returning a 400 error with a descriptive message
2. THE Admin_Image_Panel SHALL disable all image-adding controls when a product has reached 5 images
3. THE Admin_Image_Panel SHALL display the current image count and remaining slots (e.g., "3/5 images")
4. WHEN the admin attempts to select more images than the remaining slots allow, THE Admin_Image_Panel SHALL limit the selection to the number of available slots

### Requirement 8: Image Ordering

**User Story:** As an admin, I want to reorder product images, so that I can control which image appears as the catalog thumbnail and the display sequence in the gallery.

#### Acceptance Criteria

1. THE Admin_Image_Panel SHALL allow the admin to reorder images via drag-and-drop interaction
2. WHEN the admin changes the image order, THE API server SHALL update the sort_order values for all affected Product_Image records
3. THE Product_Image with sort_order value 0 SHALL be used as the Catalog_Card thumbnail across the storefront
4. FOR ALL products with multiple images, the sort_order values SHALL form a contiguous sequence starting at 0

### Requirement 9: Image Deletion

**User Story:** As an admin, I want to delete individual product images, so that I can remove outdated or incorrect images without affecting other images.

#### Acceptance Criteria

1. WHEN the admin clicks the delete button on a Product_Image, THE Admin_Image_Panel SHALL request confirmation before deleting
2. WHEN deletion is confirmed, THE API server SHALL remove the Product_Image record from the database
3. WHEN a Product_Image is deleted, THE API server SHALL reassign sort_order values to maintain a contiguous sequence starting at 0
4. IF the deleted image was stored in Supabase Storage (uploaded file), THEN THE API server SHALL also delete the file from the storage bucket

### Requirement 10: Product Detail Image Gallery

**User Story:** As a customer, I want to view all product images in an interactive gallery, so that I can inspect the product from multiple angles before purchasing.

#### Acceptance Criteria

1. THE Product_Gallery SHALL display the primary image (sort_order 0) as a large main image with a thumbnail strip showing all product images below it
2. WHEN the customer clicks a thumbnail, THE Product_Gallery SHALL display that image as the main image
3. WHEN the customer swipes left or right on the main image (mobile), THE Product_Gallery SHALL navigate to the previous or next image in sequence
4. THE Product_Gallery SHALL lazy-load images that are not currently visible
5. WHEN the customer clicks the main image (desktop), THE Product_Gallery SHALL open a full-screen lightbox with navigation controls
6. WHILE only one image exists for a product, THE Product_Gallery SHALL display the single image without thumbnail strip or navigation controls

### Requirement 11: Catalog Card Image Rendering

**User Story:** As a customer, I want catalog cards to display optimized thumbnail images, so that listing pages load quickly.

#### Acceptance Criteria

1. THE Catalog_Card SHALL display the Product_Image with sort_order 0 as the product thumbnail
2. THE Catalog_Card SHALL render the thumbnail through the Image_Proxy at 300x300 WebP quality 80
3. IF a product has no Product_Image records, THEN THE Catalog_Card SHALL display a "No image" placeholder

### Requirement 12: Image Source Tracking

**User Story:** As a product manager, I want to know where each product image came from, so that I can audit image sources and identify images that may need replacement.

#### Acceptance Criteria

1. WHEN a Product_Image is created through any sourcing method, THE API server SHALL record the Image_Source value (search, barcode, paste, or upload) alongside the image record
2. THE Admin_Image_Panel SHALL display a small badge or indicator showing the Image_Source for each Product_Image
