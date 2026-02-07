import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";

const s3Client = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });
let S3_BASE_ACCOUNTS_ARN = process.env.S3_FREE_ACCOUNTS_ARN;

// Extract bucket name from ARN if needed
const getBucketName = (arn) => {
  if (arn.startsWith('arn:aws:s3:::')) {
    return arn.replace('arn:aws:s3:::', '');
  }
  return arn; // Assume it's already a bucket name
};


const getItemCount = async (body) => { 
  console.log("item count body is: ", body);
  
  const { userId } = body; // Adjust based on your body structure
  
  if (!userId) {
    throw new Error("userId is required");
  }
  
  // Construct the S3 prefix for the user's files
  const prefix = `${userId}/`; // Adjust this based on your S3 structure
  
  let itemCount = 0;
  let continuationToken = undefined;
  
  // Paginate through all objects under the user's prefix
  do {
    const command = new ListObjectsV2Command({
      Bucket: getBucketName(S3_BASE_ACCOUNTS_ARN), // Note: This should be bucket NAME, not ARN
      Prefix: prefix,
      ContinuationToken: continuationToken
    });
    
    const response = await s3Client.send(command);
    
    // Add the count of objects in this page
    itemCount += response.KeyCount || 0;
    
    // Get the continuation token for the next page
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
  
  // Construct the S3 prefix for the user's files
  const prefix = `${userId}/`;
  
  let totalSize = 0;
  let itemCount = 0;
  let continuationToken = undefined;
  
  // Paginate through all objects under the user's prefix
  do {
    const command = new ListObjectsV2Command({
      Bucket: getBucketName(S3_BASE_ACCOUNTS_ARN),
      Prefix: prefix,
      ContinuationToken: continuationToken
    });
    
    const response = await s3Client.send(command);
    
    // Sum up the sizes of all objects in this page
    if (response.Contents) {
      for (const obj of response.Contents) {
        totalSize += obj.Size || 0;
        itemCount++;
      }
    }
    
    // Get the continuation token for the next page
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
}

export const handler = async (event) => {
  console.log("EVENT:", event);

  const route = event.routeKey; 
  const body = JSON.parse(event.body || "{}");

  try {
    let result;
    const path = event.rawPath;

    if (path.endsWith("/files/get-item-count")) {
      result = await getItemCount(body);
    }else if (path.endsWith("/files/get-folder-size")) {
      result = await getFolderSize(body);
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