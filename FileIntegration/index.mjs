import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand, CopyObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

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
  const key = `${userId}/${fileName}`;
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

const deleteFile = async (body) => {
  console.log("delete file body is: ", body);
  const { userId, fileName } = body;
  if (!userId) {
    throw new Error("userId is required");
  }
  if (!fileName) {
    throw new Error("fileName is required");
  }
  const key = `${userId}/${fileName}`;
  const command = new DeleteObjectsCommand({
    Bucket: getBucketName(S3_BASE_ACCOUNTS_ARN),
    Delete: {
      Objects: [ { Key: key } ],
      Quiet: false
    }
  });
  const response = await s3Client.send(command);
  const deleted = response.Deleted && response.Deleted.find(obj => obj.Key === key);
  if (!deleted) {
    throw new Error("File not found or could not be deleted");
  }
  return {
    userId,
    fileName,
    key,
    message: "File deleted successfully"
  };
};

const moveFile = async (body) => {
  console.log("move file body is: ", body);
  const { userId, sourceFileName, destinationFolderPath = "" } = body;

  if (!userId) {
    throw new Error("userId is required");
  }
  if (!sourceFileName) {
    throw new Error("sourceFileName is required");
  }

  const bucketName = getBucketName(S3_BASE_ACCOUNTS_ARN);
  const normalizedSource = `${sourceFileName}`.replace(/^\/+|\/+$/g, "");
  const normalizedDestination = `${destinationFolderPath}`.replace(/^\/+|\/+$/g, "");
  const fileBaseName = normalizedSource.split("/").pop();

  if (!fileBaseName) {
    throw new Error("sourceFileName is invalid");
  }

  const sourceKey = `${userId}/${normalizedSource}`;
  const destinationKey = normalizedDestination
    ? `${userId}/${normalizedDestination}/${fileBaseName}`
    : `${userId}/${fileBaseName}`;

  if (sourceKey === destinationKey) {
    return {
      success: true,
      message: "File already in destination folder",
      sourceKey,
      destinationKey
    };
  }

  const encodedCopySource = encodeURIComponent(`${bucketName}/${sourceKey}`);

  await s3Client.send(
    new CopyObjectCommand({
      Bucket: bucketName,
      CopySource: encodedCopySource,
      Key: destinationKey
    })
  );

  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: bucketName,
      Key: sourceKey
    })
  );

  return {
    success: true,
    message: "File moved successfully",
    sourceKey,
    destinationKey,
    bucketName
  };
};

const createFolder = async (body) => {
  console.log("create folder body is: ", body);
  const { userId, accountId, folderPath, folderName } = body;
  if (!userId && !accountId) {
    throw new Error("userId or accountId is required");
  }
  if (!folderName) {
    throw new Error("folderName is required");
  }
  const identifier = userId || accountId;
  const normalizedFolderPath = folderPath
    ? `${folderPath}`.replace(/^\/+|\/+$/g, "")
    : "";
  const basePath = normalizedFolderPath
    ? `${identifier}/${normalizedFolderPath}`
    : `${identifier}`;
  const fullFolderKey = `${basePath}/${folderName}/`;
  const command = new PutObjectCommand({
    Bucket: getBucketName(S3_BASE_ACCOUNTS_ARN),
    Key: fullFolderKey,
    Body: "",
    ContentType: "application/x-directory"
  });
  await s3Client.send(command);
  return {
    success: true,
    message: "Folder created successfully",
    folderPath: fullFolderKey,
    bucketName: getBucketName(S3_BASE_ACCOUNTS_ARN)
  };
};

const deleteFolder = async (body) => {
  console.log("delete folder body is: ", body);
  const { userId, accountId, folderPath } = body;
  if (!userId && !accountId) {
    throw new Error("userId or accountId is required");
  }
  if (!folderPath) {
    throw new Error("folderPath is required");
  }
  const identifier = userId || accountId;
  const normalizedFolderPath = `${folderPath}`.replace(/^\/+|\/+$/g, "");
  const fullFolderKey = `${identifier}/${normalizedFolderPath}/`;
  const bucketName = getBucketName(S3_BASE_ACCOUNTS_ARN);

  let continuationToken = undefined;
  const allKeys = [];
  do {
    const listCommand = new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: fullFolderKey,
      ContinuationToken: continuationToken
    });
    const listResponse = await s3Client.send(listCommand);
    if (listResponse.Contents) {
      for (const obj of listResponse.Contents) {
        if (obj.Key) {
          allKeys.push({ Key: obj.Key });
        }
      }
    }
    continuationToken = listResponse.NextContinuationToken;
  } while (continuationToken);

  if (allKeys.length === 0) {
    return {
      success: true,
      message: "Folder not found or already empty",
      folderPath: fullFolderKey,
      deletedCount: 0,
      bucketName
    };
  }

  const batchSize = 1000;
  let totalDeleted = 0;
  for (let i = 0; i < allKeys.length; i += batchSize) {
    const batch = allKeys.slice(i, i + batchSize);
    const deleteCommand = new DeleteObjectsCommand({
      Bucket: bucketName,
      Delete: {
        Objects: batch,
        Quiet: true
      }
    });
    await s3Client.send(deleteCommand);
    totalDeleted += batch.length;
  }

  return {
    success: true,
    message: "Folder and all contents deleted successfully",
    folderPath: fullFolderKey,
    deletedCount: totalDeleted,
    bucketName
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
    } else if (path.endsWith("/files/delete-file")) {
      result = await deleteFile(body);
    } else if (path.endsWith("/files/move-file")) {
      result = await moveFile(body);
    } else if (path.endsWith("/files/list-files")) {
      result = await listFiles(body);
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