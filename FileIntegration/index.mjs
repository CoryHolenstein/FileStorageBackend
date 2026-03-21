import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";

const s3Client = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });
let S3_BASE_ACCOUNTS_ARN = process.env.S3_FREE_ACCOUNTS_ARN;


const listFiles = async (body) => {
  console.log("list files body is: ", body);
  
  const { userId } = body;
  
  if (!userId) {
    throw new Error("userId is required");
  }
  
  const prefix = `${userId}/`;
  
  let files = [];
  let continuationToken = undefined;
  
  do {
    const command = new ListObjectsV2Command({
      Bucket: getBucketName(S3_BASE_ACCOUNTS_ARN),
      Prefix: prefix,
      ContinuationToken: continuationToken
    });
    
    const response = await s3Client.send(command);
    
    if (response.Contents) {
      for (const obj of response.Contents) {
        // Skip the folder itself (if it exists as an object)
        if (obj.Key === prefix) continue;
        
        files.push({
          id: obj.ETag?.replace(/"/g, '') || obj.Key,
          name: obj.Key.replace(prefix, ''),
          size: formatBytes(obj.Size || 0),
          sizeBytes: obj.Size || 0,
          uploadedDate: obj.LastModified?.toISOString().split('T')[0] || '',
          key: obj.Key
        });
      }
    }
    
    continuationToken = response.NextContinuationToken;
    
  } while (continuationToken);
  
  return {
    userId,
    files,
    count: files.length
  };
};

// Helper function for formatting
const formatBytes = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};


// Extract bucket name from ARN if needed
const getBucketName = (arn) => {
  if (arn.startsWith('arn:aws:s3:::')) {
    return arn.replace('arn:aws:s3:::', '');
  }
  return arn;
};

const getItemCount = async (body) => { 
  console.log("item count body is: ", body);
  
  const { userId } = body;
  
  if (!userId) {
    throw new Error("userId is required");
  }
  
  const prefix = `${userId}/`;
  
  let itemCount = 0;
  let continuationToken = undefined;
  
  do {
    const command = new ListObjectsV2Command({
      Bucket: getBucketName(S3_BASE_ACCOUNTS_ARN),
      Prefix: prefix,
      ContinuationToken: continuationToken
    });
    
    const response = await s3Client.send(command);
    itemCount += response.KeyCount || 0;
    continuationToken = response.NextContinuationToken;
    
  } while (continuationToken);
  
  return {
    userId,
    itemCount,
    prefix
  };
};

const getFolderSize = async (body) => { 
  console.log("folder size body is: ", body);
  
  const { userId } = body;
  
  if (!userId) {
    throw new Error("userId is required");
  }
  
  const prefix = `${userId}/`;
  
  let totalSize = 0;
  let itemCount = 0;
  let continuationToken = undefined;
  
  do {
    const command = new ListObjectsV2Command({
      Bucket: getBucketName(S3_BASE_ACCOUNTS_ARN),
      Prefix: prefix,
      ContinuationToken: continuationToken
    });
    
    const response = await s3Client.send(command);
    
    if (response.Contents) {
      for (const obj of response.Contents) {
        totalSize += obj.Size || 0;
        itemCount++;
      }
    }
    
    continuationToken = response.NextContinuationToken;
    
  } while (continuationToken);
  
  return {
    userId,
    totalSizeBytes: totalSize,
    totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
    totalSizeGB: (totalSize / (1024 * 1024 * 1024)).toFixed(2),
    itemCount,
    prefix
  };
};

const addFile = async (body) => {
  console.log("add file body is: ", body);
  
  const { userId, fileName, fileContent, contentType } = body;
  
  if (!userId) {
    throw new Error("userId is required");
  }
  if (!fileName) {
    throw new Error("fileName is required");
  }
  if (!fileContent) {
    throw new Error("fileContent is required");
  }
  
  // Construct the S3 key for the file
  const key = `${userId}/${fileName}`;
  
  // Decode base64 content
  const buffer = Buffer.from(fileContent, 'base64');
  
  const command = new PutObjectCommand({
    Bucket: getBucketName(S3_BASE_ACCOUNTS_ARN),
    Key: key,
    Body: buffer,
    ContentType: contentType || 'application/octet-stream'
  });
  
  await s3Client.send(command);
  
  return {
    userId,
    fileName,
    key,
    size: buffer.length,
    message: "File uploaded successfully"
  };
};

export const handler = async (event) => {
  console.log("EVENT:", event);

  const route = event.routeKey; 
  const body = JSON.parse(event.body || "{}");

  try {
    let result;
    const path = event.rawPath;

    if (path.endsWith("/files/get-item-count")) {
      result = await getItemCount(body);
    } else if (path.endsWith("/files/get-folder-size")) {
      result = await getFolderSize(body);
    } else if (path.endsWith("/files/add-file")) {
      result = await addFile(body);
    } else if (path.endsWith("/files/list-files")) {
      result = await listFiles(body);
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