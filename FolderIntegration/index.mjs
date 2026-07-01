import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";

const s3Client = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });
let S3_BASE_ACCOUNTS_ARN = process.env.S3_FREE_ACCOUNTS_ARN;

const safeLogBody = (body = {}) => {
  if (!body || typeof body !== "object") {
    return body;
  }

  const { fileContent, ...rest } = body;
  if (!fileContent) {
    return rest;
  }

  return {
    ...rest,
    fileContentLength: fileContent.length
  };
};

// Extract bucket name from ARN if needed
const getBucketName = (arn) => {
  if (arn.startsWith('arn:aws:s3:::')) {
    return arn.replace('arn:aws:s3:::', '');
  }
  return arn; // Assume it's already a bucket name
};

let createInitialFolder = async (body) => {
  const { userId, accountId, email } = body;

  // Validate required fields
  if (!userId && !accountId && !email) {
    throw new Error('userId, accountId, or email is required');
  }

  const bucketName = getBucketName(S3_BASE_ACCOUNTS_ARN);
  const identifier = userId || accountId || email.replace('@', '_at_');
  
  // Create initial folder structure
  // S3 doesn't have real folders, but we create them by adding objects with trailing slashes
  const folders = [
    `${identifier}/`,
    `${identifier}/documents/`,
    `${identifier}/images/`,
    `${identifier}/files/`,
  ];

  try {
    // Create all folders in parallel
    const uploadPromises = folders.map(async (folderKey) => {
      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: folderKey,
        Body: '', // Empty body creates a "folder" marker
        ContentType: 'application/x-directory',
      });
      
      return await s3Client.send(command);
    });

    await Promise.all(uploadPromises);

    return {
      success: true,
      message: 'Initial folder structure created successfully',
      folders: folders,
      basePath: `${identifier}/`,
      bucketName: bucketName,
    };
  } catch (error) {
    console.error('Error creating initial folders:', error);
    throw new Error(`Failed to create initial folders: ${error.message}`);
  }
};

let createFolder = async (body) => {
  const { userId, accountId, folderPath, folderName } = body;

  // Validate required fields
  if (!userId && !accountId) {
    throw new Error('userId or accountId is required');
  }
  
  if (!folderName) {
    throw new Error('folderName is required');
  }

  const bucketName = getBucketName(S3_BASE_ACCOUNTS_ARN);
  const identifier = userId || accountId;
  
  // Construct the full folder path
  const basePath = folderPath ? `${identifier}/${folderPath}` : identifier;
  const fullFolderKey = `${basePath}/${folderName}/`;

  try {
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: fullFolderKey,
      Body: '',
      ContentType: 'application/x-directory',
    });

    await s3Client.send(command);

    return {
      success: true,
      message: 'Folder created successfully',
      folderPath: fullFolderKey,
      bucketName: bucketName,
    };
  } catch (error) {
    console.error('Error creating folder:', error);
    throw new Error(`Failed to create folder: ${error.message}`);
  }
};

let deleteFolder = async (body) => {
  const { userId, accountId, folderPath } = body;

  // Validate required fields
  if (!userId && !accountId) {
    throw new Error('userId or accountId is required');
  }
  
  if (!folderPath) {
    throw new Error('folderPath is required');
  }

  const bucketName = getBucketName(S3_BASE_ACCOUNTS_ARN);
  const identifier = userId || accountId;
  
  // Construct the full folder path - ensure it ends with /
  const fullFolderKey = folderPath.endsWith('/') 
    ? `${identifier}/${folderPath}` 
    : `${identifier}/${folderPath}/`;

  try {
    // List all objects in the folder (including subfolders)
    let allObjects = [];
    let continuationToken = null;

    do {
      const listCommand = new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: fullFolderKey,
        ContinuationToken: continuationToken,
      });

      const listResponse = await s3Client.send(listCommand);
      
      if (listResponse.Contents && listResponse.Contents.length > 0) {
        allObjects.push(...listResponse.Contents);
      }

      continuationToken = listResponse.IsTruncated ? listResponse.NextContinuationToken : null;
    } while (continuationToken);

    // If no objects found, folder doesn't exist or is already empty
    if (allObjects.length === 0) {
      return {
        success: true,
        message: 'Folder not found or already empty',
        folderPath: fullFolderKey,
        deletedCount: 0,
      };
    }

    // Delete objects in batches of 1000 (S3 limit)
    const batchSize = 1000;
    let totalDeleted = 0;

    for (let i = 0; i < allObjects.length; i += batchSize) {
      const batch = allObjects.slice(i, i + batchSize);
      
      const deleteCommand = new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: {
          Objects: batch.map(obj => ({ Key: obj.Key })),
          Quiet: true, // Don't return info about each deleted object
        },
      });

      const deleteResponse = await s3Client.send(deleteCommand);
      totalDeleted += batch.length;

      // Check for errors
      if (deleteResponse.Errors && deleteResponse.Errors.length > 0) {
        console.error('Some objects failed to delete:', deleteResponse.Errors);
      }
    }

    return {
      success: true,
      message: 'Folder and all contents deleted successfully',
      folderPath: fullFolderKey,
      deletedCount: totalDeleted,
      bucketName: bucketName,
    };
  } catch (error) {
    console.error('Error deleting folder:', error);
    throw new Error(`Failed to delete folder: ${error.message}`);
  }
};

export const handler = async (event) => {
  console.log("EVENT:", {
    routeKey: event?.routeKey,
    rawPath: event?.rawPath,
    requestId: event?.requestContext?.requestId
  });

  const route = event.routeKey; 
  const body = JSON.parse(event.body || "{}");
  console.log("REQUEST BODY:", safeLogBody(body));

  const jwtSub = event?.requestContext?.authorizer?.jwt?.claims?.sub;
  if (jwtSub) {
    body.userId = jwtSub;
  }

  try {
    let result;
    const path = event.rawPath;

    if (path.endsWith("/folders/create-initial-folder")) {
      result = await createInitialFolder(body);
    } else if (path.endsWith("/folders/create-folder")) {
      result = await createFolder(body);
    } else if (path.endsWith("/folders/delete-folder")) {
      result = await deleteFolder(body);
    } else {
      return { statusCode: 400, body: "Unknown route" };
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify(result)
    };

  } catch (err) {
    console.error("Error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};