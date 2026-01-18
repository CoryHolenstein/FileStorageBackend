import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const s3Client = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });
let S3_BASE_ACCOUNTS_ARN = process.env.S3_FREE_ACCOUNTS_ARN;

// Extract bucket name from ARN if needed
const getBucketName = (arn) => {
  if (arn.startsWith('arn:aws:s3::: ')) {
    return arn.replace('arn:aws:s3:: :', '');
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
  const identifier = userId || accountId || email. replace('@', '_at_');
  
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
  const basePath = folderPath ?  `${identifier}/${folderPath}` : identifier;
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
      success:  true,
      message: 'Folder created successfully',
      folderPath: fullFolderKey,
      bucketName: bucketName,
    };
  } catch (error) {
    console.error('Error creating folder:', error);
    throw new Error(`Failed to create folder: ${error.message}`);
  }
};

export const handler = async (event) => {
  console.log("EVENT:", event);

  const route = event. routeKey; 
  const body = JSON.parse(event. body || "{}");

  try {
    let result;
    const path = event.rawPath;

    if (path.endsWith("/folders/create-initial-folder")) {
      result = await createInitialFolder(body);
    } else if (path.endsWith("/folders/create-folder")) {
      result = await createFolder(body);
    } else if (path.endsWith("/folders/get-all-tasks")) {
     // result = await getAllTasks(body);
    } else if (path.endsWith("/folders/delete-task")) {
     // result = await deleteTask(body);
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